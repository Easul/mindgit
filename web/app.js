const systemThemeMediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function storedThemePreference() {
  const theme = localStorage.getItem('mindgit-theme');
  return theme === 'dark' || theme === 'light' ? theme : null;
}

function systemThemePreference() {
  return systemThemeMediaQuery?.matches ? 'dark' : 'light';
}

const initialParams = new URLSearchParams(window.location.search);
const temporaryTabPrefix = 'mindgit-temporary:';
const externalTabPrefix = 'mindgit-external:';

function isTemporaryTab(path) {
  return typeof path === 'string' && path.startsWith(temporaryTabPrefix);
}

function isExternalTab(path) {
  return typeof path === 'string' && path.startsWith(externalTabPrefix);
}

function externalTabPath(path) {
  return isExternalTab(path) ? path.slice(externalTabPrefix.length) : path;
}

function externalTabId(path) {
  return `${externalTabPrefix}${path}`;
}

function filePathForTab(path) {
  return isExternalTab(path) ? externalTabPath(path) : path;
}

function fileRequestPath(pathname, tabPath) {
  const url = new URL(pathname, window.location.origin);
  url.searchParams.set('path', filePathForTab(tabPath));
  if (isExternalTab(tabPath)) url.searchParams.set('external', '1');
  return `${url.pathname}${url.search}`;
}

function tabIsWritable(path) {
  return state.fileAccess.get(path)?.writable !== false;
}

async function ensureFileInfo(path) {
  if (!path || isTemporaryTab(path)) return null;
  const existing = state.fileAccess.get(path);
  if (existing) return existing;
  const result = await api(`/api/fs?path=${encodeURIComponent(filePathForTab(path))}`);
  const info = isExternalTab(path)
    ? { ...result, path: externalTabPath(path), external: true }
    : result;
  state.fileAccess.set(path, info);
  return info;
}

const state = {
  view: 'worktree',
  status: null,
  selected: null,
  mode: 'full',
  embed: initialParams.get('embed') === '1',
  initialPath: initialParams.get('path') || '',
  initialMode: initialParams.get('mode') || '',
  initialProjectKey: initialParams.get('project') || '',
  projects: [],
  projectsByKey: new Map(),
  sshConnections: [],
  currentProjectKey: '',
  workspace: { activeProjectKey: '', projects: {} },
  migratedLegacyWorkspace: false,
  mobileViewerExpanded: false,
  editorReady: false,
  saveInProgress: false,
  instanceId: window.crypto?.randomUUID ? window.crypto.randomUUID() : String(Date.now() + Math.random()),
  splitPane: {
    open: false,
    orientation: 'right',
    tabs: [],
    selectedPath: '',
    mode: 'full',
  },
  content: '',
  theme: window.__mindgitInitialTheme || storedThemePreference() || systemThemePreference(),
  expandedGroups: new Set(),
  children: new Map(),
  history: [],
  selectedCommit: null,
  commitFiles: [],
  selectedCommitFile: null,
  wordWrap: localStorage.getItem('mindgit-wordwrap') === 'true',
  openTabs: [],
  tabStates: {},
  tabDrafts: {},
  tabOriginals: {},
  temporaryTabs: new Map(),
  fileAccess: new Map(),
};

const $ = (id) => document.getElementById(id);

const layoutStorageKey = 'mindgit-layout-v1';
const workspaceStorageKey = 'mindgit-workspace-v2';
const legacyWorkspaceStorageKey = 'mindgit-workspace-v1';
let splitPaneResizeObserver = null;
let projectSwitcherSyncFrame = 0;
let runtimeStatsTimer = 0;
const stoppingRuntimeProcesses = new Set();

async function ensureAuthenticated() {
  const response = await fetch('/api/auth/status', { cache: 'no-store' });
  const status = await response.json();
  if (!response.ok) throw new Error(status.error || response.statusText);
  if (!status.enabled || status.authenticated) return;

  const dialog = $('login-dialog');
  const form = $('login-form');
  const password = $('login-password');
  const error = $('login-error');
  const submit = $('login-submit');
  dialog.hidden = false;
  requestAnimationFrame(() => password.focus());

  await new Promise((resolve) => {
    const unlock = async (event) => {
      event.preventDefault();
      error.textContent = '';
      submit.disabled = true;
      try {
        const loginResponse = await fetch('/api/auth/login', {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: password.value }),
        });
        if (!loginResponse.ok) {
          const message = (await loginResponse.text()).trim();
          throw new Error(message || loginResponse.statusText);
        }
        form.removeEventListener('submit', unlock);
        password.value = '';
        dialog.hidden = true;
        resolve();
      } catch (loginError) {
        error.textContent = loginError.message;
        password.select();
      } finally {
        submit.disabled = false;
      }
    };
    form.addEventListener('submit', unlock);
  });
}

function formatRuntimeBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function formatRuntimeDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = Math.floor(total % 60);
  return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${remaining}s` : `${remaining}s`;
}

function renderRuntimeStats(stats) {
  const cards = [
    ['CPU', stats.cpuAvailable ? `${stats.cpuPercent.toFixed(1)}%` : 'Unavailable'],
    ['Process RSS', stats.memoryAvailable ? formatRuntimeBytes(stats.memoryBytes) : 'Unavailable'],
    ['Go Heap', formatRuntimeBytes(stats.heapBytes)],
    ['Go Reserved', formatRuntimeBytes(stats.goSystemBytes)],
    ['Heap Reserved', formatRuntimeBytes(stats.heapSystemBytes)],
    ['Go Stack', formatRuntimeBytes(stats.stackBytes)],
    ['Go Metadata', formatRuntimeBytes(stats.metadataBytes)],
    ['Heap Objects', Number(stats.heapObjects).toLocaleString()],
    ['Goroutines', Number(stats.goroutines).toLocaleString()],
    ['GC Runs', Number(stats.gcCount).toLocaleString()],
    ['Uptime', formatRuntimeDuration(stats.uptimeSeconds)],
    ['Active Commands', Number(stats.activeCommands).toLocaleString()],
    ['Commands', Number(stats.commands).toLocaleString()],
    ['Failed Commands', Number(stats.failedCommands).toLocaleString()],
    ['Average Command', `${Number(stats.averageCommandMs).toFixed(1)} ms`],
    ['Terminals', Number(stats.terminalSessions).toLocaleString()],
  ];
  $('runtime-grid').innerHTML = cards.map(([label, value]) => `
    <div class="runtime-card">
      <div class="runtime-card-label">${escapeHTML(label)}</div>
      <div class="runtime-card-value">${escapeHTML(value)}</div>
    </div>`).join('');

  const processes = Array.isArray(stats.processes) ? stats.processes : [];
  $('runtime-child-memory').textContent = `${t('Child process memory')}: ${formatRuntimeBytes(stats.childMemoryBytes || 0)}`;
  $('runtime-processes').innerHTML = processes.length ? processes.map((process) => {
    const stopping = stoppingRuntimeProcesses.has(process.id);
    const command = process.project ? `${process.command} · ${process.project}` : process.command;
    return `<tr>
      <td><span class="runtime-process-kind">${escapeHTML(t(runtimeProcessKind(process.kind)))}</span></td>
      <td class="runtime-process-pid">${escapeHTML(String(process.pid || '-'))}</td>
      <td class="runtime-process-command" title="${escapeHTML(command)}">${escapeHTML(command)}</td>
      <td>${escapeHTML(process.memoryAvailable ? formatRuntimeBytes(process.memoryBytes) : t('Unavailable'))}</td>
      <td>${escapeHTML(formatRuntimeDuration(process.uptimeSeconds))}</td>
      <td>${process.closable ? `<button class="runtime-process-close" type="button" data-process-id="${escapeHTML(process.id)}" title="${escapeHTML(t('Close process'))}" aria-label="${escapeHTML(t('Close process'))}" ${stopping ? 'disabled' : ''}>${stopping ? '…' : '×'}</button>` : ''}</td>
    </tr>`;
  }).join('') : `<tr><td class="runtime-process-empty" colspan="6">${escapeHTML(t('No managed processes'))}</td></tr>`;
}

function runtimeProcessKind(kind) {
  return ({
    mindgit: 'MindGit',
    git: 'Git command',
    ssh: 'SSH command',
    shell: 'Shell command',
    rg: 'Search command',
    terminal: 'Terminal',
    'ssh-terminal': 'SSH terminal',
  })[kind] || 'Command';
}

async function closeRuntimeProcess(id) {
  if (!id || id === 'mindgit' || stoppingRuntimeProcesses.has(id)) return;
  const confirmed = await showConfirmDialog({
    title: t('Close process'),
    message: t('This stops the selected command or terminal started by MindGit.'),
    confirmLabel: t('Close'),
    cancelLabel: t('Cancel'),
    danger: true,
  });
  if (!confirmed) return;
  stoppingRuntimeProcesses.add(id);
  await refreshRuntimeStats();
  try {
    await api(`/api/runtime/process?id=${encodeURIComponent(id)}`, { method: 'DELETE', includeProject: false });
  } catch (error) {
    $('runtime-error').textContent = error.message;
  } finally {
    stoppingRuntimeProcesses.delete(id);
    await refreshRuntimeStats();
  }
}

async function refreshRuntimeStats() {
  try {
    const stats = await api('/api/runtime/stats', { includeProject: false });
    $('runtime-error').textContent = '';
    renderRuntimeStats(stats);
  } catch (error) {
    $('runtime-error').textContent = error.message;
  }
}

function openRuntimeStats() {
  $('runtime-dialog').hidden = false;
  refreshRuntimeStats();
  window.clearInterval(runtimeStatsTimer);
  runtimeStatsTimer = window.setInterval(refreshRuntimeStats, 1500);
}

function closeRuntimeStats() {
  $('runtime-dialog').hidden = true;
  window.clearInterval(runtimeStatsTimer);
  runtimeStatsTimer = 0;
}

function normalizeMode(mode) {
  return ['diff', 'full', 'edit'].includes(mode) ? mode : 'full';
}

function uniquePaths(paths) {
  if (!Array.isArray(paths)) return [];
  return [...new Set(paths.filter((path) => typeof path === 'string' && path.trim()))];
}

function normalizeProjectWorkspace(parsed = {}) {
  const splitPane = parsed.splitPane || {};
  const rawSelectedPath = typeof splitPane.selectedPath === 'string'
    ? splitPane.selectedPath
    : typeof splitPane.path === 'string'
      ? splitPane.path
      : '';
  const selectedPath = isTemporaryTab(rawSelectedPath) ? '' : rawSelectedPath;
  const savedSelected = typeof parsed.selected === 'string' && !isTemporaryTab(parsed.selected)
    ? parsed.selected
    : null;
  const openTabs = uniquePaths([...(parsed.openTabs || []), savedSelected]).filter((path) => !isTemporaryTab(path));
  const splitTabs = uniquePaths([...(splitPane.tabs || []), selectedPath]).filter((path) => !isTemporaryTab(path));
  const selectedCommitHash = typeof parsed.selectedCommitHash === 'string'
    ? parsed.selectedCommitHash
    : typeof parsed.selectedCommit?.hash === 'string'
      ? parsed.selectedCommit.hash
      : null;
  return {
    view: parsed.view === 'history' ? 'history' : 'worktree',
    selected: savedSelected,
    mode: normalizeMode(parsed.mode),
    mobileViewerExpanded: Boolean(parsed.mobileViewerExpanded),
    openTabs,
    tabStates: parsed.tabStates && typeof parsed.tabStates === 'object'
      ? Object.fromEntries(Object.entries(parsed.tabStates).filter(([path]) => !isTemporaryTab(path)))
      : {},
    expandedGroups: uniquePaths(parsed.expandedGroups || []),
    splitPane: {
      open: Boolean(splitPane.open && selectedPath),
      orientation: splitPane.orientation === 'down' ? 'down' : 'right',
      tabs: splitTabs,
      selectedPath,
      mode: normalizeMode(splitPane.mode),
    },
    selectedCommitHash,
    selectedCommitFile: typeof parsed.selectedCommitFile === 'string' ? parsed.selectedCommitFile : null,
  };
}

function defaultProjectWorkspace() {
  return normalizeProjectWorkspace();
}

function loadStoredWorkspaceBundle() {
  if (state.embed) {
    return { activeProjectKey: '', projects: {} };
  }

  try {
    const raw = localStorage.getItem(workspaceStorageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      const projects = {};
      const storedProjects = parsed.projects && typeof parsed.projects === 'object' ? parsed.projects : {};
      for (const [key, value] of Object.entries(storedProjects)) {
        projects[key] = normalizeProjectWorkspace(value);
      }
      return {
        activeProjectKey: typeof parsed.activeProjectKey === 'string' ? parsed.activeProjectKey : '',
        projects,
      };
    }
  } catch {}

  try {
    const raw = localStorage.getItem(legacyWorkspaceStorageKey);
    if (!raw) return { activeProjectKey: '', projects: {} };
    state.migratedLegacyWorkspace = true;
    return {
      activeProjectKey: '',
      projects: state.projects[0] ? { [state.projects[0].key]: normalizeProjectWorkspace(JSON.parse(raw)) } : {},
    };
  } catch {
    return { activeProjectKey: '', projects: {} };
  }
}

function projectWorkspace(projectKey = state.currentProjectKey) {
  if (!projectKey) return defaultProjectWorkspace();
  if (!state.workspace.projects[projectKey]) {
    state.workspace.projects[projectKey] = defaultProjectWorkspace();
  }
  return state.workspace.projects[projectKey];
}

function captureProjectWorkspace() {
  if (!state.currentProjectKey) return;
  state.workspace.activeProjectKey = state.currentProjectKey;
  state.workspace.projects[state.currentProjectKey] = normalizeProjectWorkspace({
    view: state.view,
    selected: state.selected,
    mode: state.mode,
    mobileViewerExpanded: state.mobileViewerExpanded,
    openTabs: state.openTabs,
    tabStates: state.tabStates,
    expandedGroups: [...state.expandedGroups],
    splitPane: state.splitPane,
    selectedCommitHash: state.selectedCommit?.hash || null,
    selectedCommitFile: state.selectedCommitFile,
  });
}

function applyProjectWorkspace(projectKey) {
  const saved = projectWorkspace(projectKey);
  state.view = saved.view;
  state.selected = saved.selected;
  state.mode = saved.mode;
  state.mobileViewerExpanded = saved.mobileViewerExpanded;
  state.openTabs = saved.openTabs;
  state.tabStates = saved.tabStates;
  state.tabDrafts = {};
  state.tabOriginals = {};
  state.temporaryTabs = new Map();
  state.fileAccess = new Map();
  state.expandedGroups = new Set(saved.expandedGroups);
  state.splitPane = saved.splitPane;
  state.children = new Map();
  state.history = [];
  state.selectedCommit = saved.selectedCommitHash ? { hash: saved.selectedCommitHash } : null;
  state.commitFiles = [];
  state.selectedCommitFile = saved.selectedCommitFile;
  state.status = null;
  state.content = '';
  state.editorReady = false;
  state.saveInProgress = false;
}

function chooseInitialProjectKey() {
  const available = new Set(state.projects.map((project) => project.key));
  if (state.initialProjectKey && available.has(state.initialProjectKey)) {
    return state.initialProjectKey;
  }
  if (!state.embed && state.workspace.activeProjectKey && available.has(state.workspace.activeProjectKey)) {
    return state.workspace.activeProjectKey;
  }
  return state.projects[0]?.key || '';
}

function saveWorkspaceState() {
  captureProjectWorkspace();
  if (state.embed) return;
  localStorage.setItem(workspaceStorageKey, JSON.stringify(state.workspace));
  if (state.migratedLegacyWorkspace) {
    localStorage.removeItem(legacyWorkspaceStorageKey);
    state.migratedLegacyWorkspace = false;
  }
}

function notifyEmbedState() {
  if (!state.embed || !window.parent) return;
  window.parent.postMessage({
    type: 'mindgit:split-state',
    payload: {
      selectedPath: state.selected,
      mode: state.mode,
      tabs: state.openTabs,
    },
  }, window.location.origin);
}

function notifySplitTheme() {
  if (state.embed || !state.splitPane.open) return;
  const target = splitIframeWindow();
  if (!target) return;
  target.postMessage({
    type: 'mindgit:theme',
    payload: { theme: state.theme },
  }, window.location.origin);
}

function notifySplitEmbedState() {
  if (state.embed || !state.splitPane.open) return;
  const target = splitIframeWindow();
  if (!target) return;
  target.postMessage({
    type: 'mindgit:embed-state',
    payload: {
      projectKey: state.currentProjectKey,
      selectedPath: state.splitPane.selectedPath,
      mode: state.splitPane.mode,
      tabs: state.splitPane.tabs,
    },
  }, window.location.origin);
}

function splitIframeWindow() {
  return $('split-pane-iframe')?.contentWindow || null;
}

function editorContentFor(path) {
  if (state.selected !== path) return null;
  const editor = $('editor');
  if (editor) return editor.value;
  return state.mode === 'edit' ? state.content : null;
}

function broadcastEditorContent(path, content) {
  const message = {
    type: 'mindgit:file-content-updated',
    payload: {
      path,
      content,
      sourceId: state.instanceId,
    },
  };

  if (state.embed && window.parent) {
    window.parent.postMessage(message, window.location.origin);
    return;
  }

  const target = splitIframeWindow();
  if (target && state.splitPane.open) {
    target.postMessage(message, window.location.origin);
  }
}

function applyExternalFileContent(path, content) {
  if (!path || state.selected !== path) return;

  const editor = $('editor');
  if (editor?._mindgitComposing) {
    editor._mindgitPendingRemoteContent = content;
    return;
  }

  state.content = content;
  state.tabDrafts[path] = content;
  if (editor) {
    if (editor.value === content) return;
    const selectionStart = Math.min(editor.selectionStart, content.length);
    const selectionEnd = Math.min(editor.selectionEnd, content.length);
    editor._mindgitApplyingRemote = true;
    editor.value = content;
    editor.setSelectionRange(selectionStart, selectionEnd);
    editor.dispatchEvent(new Event('input'));
    editor._mindgitApplyingRemote = false;
    return;
  }

  if (state.mode === 'full' && !isLikelyBinary(path) && !isImageFile(path)) {
    renderFullContent(content, path);
  }
}

function handleFileContentMessage(event) {
  if (event.origin !== window.location.origin) return false;
  const data = event.data || {};
  if (data.type !== 'mindgit:file-content-updated') return false;

  const payload = data.payload || {};
  if (!payload.path || payload.sourceId === state.instanceId) return true;

  applyExternalFileContent(payload.path, payload.content || '');

  const iframeWindow = splitIframeWindow();
  if (!state.embed && iframeWindow && event.source !== iframeWindow) {
    iframeWindow.postMessage(data, window.location.origin);
  }
  return true;
}

function parseInitialTabs() {
  try {
    return uniquePaths(JSON.parse(initialParams.get('tabs') || '[]'));
  } catch {
    return [];
  }
}

function currentProject() {
  return state.projectsByKey.get(state.currentProjectKey) || null;
}

function syncProjectSwitcherLabel() {
  projectSwitcherSyncFrame = 0;
  const button = $('project-switcher');
  const label = $('project-switcher-label');
  if (!button || !label || button.hidden) return;

  const fullLabel = button.dataset.fullLabel || '';
  label.textContent = fullLabel;
  if (!fullLabel) return;

  const availableWidth = label.clientWidth;
  if (!availableWidth || label.scrollWidth <= availableWidth) return;

  const suffix = '..';
  let best = suffix;
  let low = 0;
  let high = fullLabel.length;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = `${fullLabel.slice(0, mid)}${suffix}`;
    label.textContent = candidate;
    if (label.scrollWidth <= availableWidth) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  label.textContent = best;
}

function scheduleProjectSwitcherLabelSync() {
  if (projectSwitcherSyncFrame) cancelAnimationFrame(projectSwitcherSyncFrame);
  projectSwitcherSyncFrame = requestAnimationFrame(syncProjectSwitcherLabel);
}

function updateProjectSwitcher() {
  const button = $('project-switcher');
  if (!button) return;
  const project = currentProject();
  const visible = !state.embed && state.projects.length > 1 && project;
  button.hidden = !visible;
  button.dataset.fullLabel = project?.name || '';
  if (!project) {
    const label = $('project-switcher-label');
    if (label) label.textContent = '';
    button.title = '';
    return;
  }
  const label = $('project-switcher-label');
  if (label) label.textContent = project.name;
  button.title = project.root;
  scheduleProjectSwitcherLabelSync();
}

async function loadProjects() {
  const response = await fetch('/api/projects', { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  state.projects = Array.isArray(data.projects) ? data.projects : [];
  state.projectsByKey = new Map(state.projects.map((project) => [project.key, project]));
  state.workspace = loadStoredWorkspaceBundle();
  state.currentProjectKey = chooseInitialProjectKey();
  applyProjectWorkspace(state.currentProjectKey);
  updateProjectSwitcher();
  if (!state.embed && state.currentProjectKey) {
    saveWorkspaceState();
  }
}

async function loadSSHConnections() {
  try {
    const connections = await api('/api/ssh/connections', { includeProject: false });
    state.sshConnections = Array.isArray(connections) ? connections : [];
  } catch {
    state.sshConnections = [];
  }
}

function openProjectMenu(anchor) {
  if (state.projects.length < 2) return;
  showActionMenu(anchor, state.projects.map((project) => ({
    label: project.name,
    active: project.key === state.currentProjectKey,
    action: () => switchProject(project.key),
  })));
}

function rememberTabOriginal(path, content) {
  if (!path || isTemporaryTab(path) || typeof content !== 'string') return;
  if (typeof state.tabOriginals[path] !== 'string') {
    state.tabOriginals[path] = content;
  }
}

function tabHasUnsavedChanges(path) {
  if (!path) return false;
  if (isTemporaryTab(path)) {
    return state.temporaryTabs.has(path)
      && typeof state.tabDrafts[path] === 'string'
      && state.tabDrafts[path].length > 0;
  }
  const draft = state.tabDrafts[path];
  const original = state.tabOriginals[path];
  return typeof draft === 'string' && typeof original === 'string' && draft !== original;
}

function unsavedTabPaths() {
  return state.openTabs.filter(tabHasUnsavedChanges);
}

async function saveTabsBeforeProjectSwitch() {
  saveCurrentTabState();
  const paths = unsavedTabPaths();
  if (!paths.length) return true;

  const names = paths.map((path) => isTemporaryTab(path)
    ? state.temporaryTabs.get(path)?.name || 'Untitled'
    : filePathForTab(path));
  const preview = names.slice(0, 5).join('\n');
  const remainder = names.length > 5 ? `\n…and ${names.length - 5} more` : '';
  const confirmed = await showConfirmDialog({
    title: 'Save Unsaved Tabs',
    message: `${names.length} tab(s) have unsaved changes:\n${preview}${remainder}\n\nSave them before switching projects?`,
    confirmLabel: 'Save and Switch',
    cancelLabel: 'Cancel',
  });
  if (!confirmed) return false;

  for (const path of paths) {
    if (!state.openTabs.includes(path)) continue;
    if (state.selected !== path) await selectTab(path);
    if (!await saveFile()) return false;
  }
  return true;
}

async function switchProject(projectKey) {
  if (!projectKey || projectKey === state.currentProjectKey) return;
  if (!await saveTabsBeforeProjectSwitch()) return;
  saveCurrentTabState();
  captureProjectWorkspace();
  cleanupSplitPaneResizeObserver();
  state.currentProjectKey = projectKey;
  applyProjectWorkspace(projectKey);
  updateProjectSwitcher();
  syncLayoutState();
  renderFileTabs();
  $('viewer').innerHTML = '<div class="empty">Loading project...</div>';
  saveWorkspaceState();
  await refresh();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function loadLayoutPrefs() {
  try {
    const raw = localStorage.getItem(layoutStorageKey);
    if (!raw) {
      return {
        leftPaneWidth: 240,
        rightPaneWidth: 260,
        splitRatioRight: 0.5,
        splitRatioDown: 0.5,
      };
    }
    const parsed = JSON.parse(raw);
    return {
      leftPaneWidth: clamp(Number(parsed.leftPaneWidth) || 240, 180, 420),
      rightPaneWidth: clamp(Number(parsed.rightPaneWidth) || 260, 200, 480),
      splitRatioRight: clamp(Number(parsed.splitRatioRight) || 0.5, 0.25, 0.75),
      splitRatioDown: clamp(Number(parsed.splitRatioDown) || 0.5, 0.25, 0.75),
    };
  } catch {
    return {
      leftPaneWidth: 240,
      rightPaneWidth: 260,
      splitRatioRight: 0.5,
      splitRatioDown: 0.5,
    };
  }
}

state.layout = loadLayoutPrefs();

function saveLayoutPrefs() {
  localStorage.setItem(layoutStorageKey, JSON.stringify(state.layout));
}

function applyLayoutVars() {
  const root = document.documentElement;
  root.style.setProperty('--left-pane-width', `${state.layout.leftPaneWidth}px`);
  root.style.setProperty('--right-pane-width', `${state.layout.rightPaneWidth}px`);
  root.style.setProperty('--split-main-right', `${state.layout.splitRatioRight * 100}%`);
  root.style.setProperty('--split-side-right', `${(1 - state.layout.splitRatioRight) * 100}%`);
  root.style.setProperty('--split-main-down', `${state.layout.splitRatioDown * 100}%`);
  root.style.setProperty('--split-side-down', `${(1 - state.layout.splitRatioDown) * 100}%`);
}

function syncViewerHeight() {
  const pane = document.querySelector('.primary-editor-pane');
  const viewer = $('viewer');
  if (!pane || !viewer) return;

  const tabs = document.querySelector('.primary-editor-pane > .file-tabs');
  const tabsVisible = tabs && getComputedStyle(tabs).display !== 'none';
  const tabsHeight = tabsVisible ? tabs.offsetHeight : 0;
  const nextHeight = Math.max(0, pane.clientHeight - tabsHeight);
  viewer.style.height = `${nextHeight}px`;
}

function syncLayoutState() {
  applyLayoutVars();
  document.documentElement.dataset.view = state.view;
  document.documentElement.dataset.mode = state.mode;
  document.documentElement.dataset.selected = state.selected ? 'true' : 'false';
  document.documentElement.dataset.viewerOpen = (
    (state.view === 'worktree' && state.selected) ||
    (state.view === 'history' && state.selectedCommitFile)
  ) ? 'true' : 'false';
  document.documentElement.dataset.mobileExpanded = state.mobileViewerExpanded ? 'true' : 'false';
  document.documentElement.dataset.embed = state.embed ? 'true' : 'false';
  document.documentElement.dataset.splitOpen = state.view === 'worktree' && state.splitPane.open ? 'true' : 'false';
  document.documentElement.dataset.splitOrientation = state.splitPane.orientation;
  syncViewerHeight();

  const rootMenuButton = $('tree-root-menu');
  if (rootMenuButton) rootMenuButton.hidden = state.view !== 'worktree';
}

async function api(path, options) {
  const { includeProject = true, ...fetchOptions } = options || {};
  const url = new URL(path, window.location.origin);
  if (includeProject && state.currentProjectKey) {
    url.searchParams.set('project', state.currentProjectKey);
  }
  const response = await fetch(`${url.pathname}${url.search}`, {
    cache: 'no-store',
    ...fetchOptions,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

async function setView(view) {
  if (state.view === view) return;
  if (view === 'history' && state.status && !state.status.gitAvailable) {
    setMessage('Git not available for this folder', 'error');
    return;
  }
  if (state.view === 'worktree') {
    saveCurrentTabState();
  }
  state.view = view;
  if (view === 'history') {
    state.selectedCommitFile = null;
    $('viewer').innerHTML = '<div class="empty">No file selected</div>';
  }
  state.mobileViewerExpanded = false;
  syncLayoutState();
  renderFileTabs();
  renderSplitPane();
  saveWorkspaceState();
  await refresh();
}

async function refresh() {
  try {
    setMessage('Refreshing...');
    syncLayoutState();
    if ($('worktree-view')) $('worktree-view').classList.toggle('active', state.view === 'worktree');
    if ($('history-view')) $('history-view').classList.toggle('active', state.view === 'history');
    if (state.view === 'history') {
      state.status = await api('/api/status');
      if (!state.status.gitAvailable) {
        state.view = 'worktree';
        state.selectedCommit = null;
        state.commitFiles = [];
        state.selectedCommitFile = null;
        renderStatus();
        renderFileTabs();
        syncLayoutState();
        renderSplitPane();
        setMessage('Git not available for this folder', 'error');
        return;
      }
      await loadHistory();
      renderHistory();
      renderSplitPane();
      setMessage('Updated', 'ok');
      return;
    }
    state.status = await api('/api/status');
    await refreshLoadedGroups();
    renderStatus();
    renderFileTabs();
    if (state.selected) {
      await renderSelected();
    } else {
      $('viewer').innerHTML = `<div class="empty">${state.status.files.length ? 'Select a file from the tree' : 'Folder is empty'}</div>`;
    }
    renderSplitPane();
    setMessage('Updated', 'ok');
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

async function refreshWorkspaceOutline() {
  try {
    setMessage('Refreshing...');
    syncLayoutState();
    if ($('worktree-view')) $('worktree-view').classList.toggle('active', state.view === 'worktree');
    if ($('history-view')) $('history-view').classList.toggle('active', state.view === 'history');

    if (state.view === 'history') {
      await loadHistory();
      renderHistory();
      setMessage('Updated', 'ok');
      return;
    }

    const fileList = $('file-list');
    const treeScrollTop = fileList ? fileList.scrollTop : 0;
    state.status = await api('/api/status');
    await refreshLoadedGroups();
    renderStatus();
    renderFileTabs();
    if (fileList) fileList.scrollTop = treeScrollTop;
    setMessage('Updated', 'ok');
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

function renderStatus() {
  const status = state.status;
  if (!status) return;
  updateProjectSwitcher();
  if ($('root')) $('root').textContent = status.root;
  if ($('branch')) $('branch').textContent = status.branch;
  if ($('modified')) $('modified').textContent = status.modified;
  if ($('added')) $('added').textContent = status.added + status.untracked;
  if ($('deleted')) $('deleted').textContent = status.deleted;
  if ($('lines')) $('lines').textContent = `+${status.additions} -${status.deletions}`;
  if ($('change-title')) {
    $('change-title').textContent = status.gitAvailable
      ? `Changes (${status.modified + status.added + status.deleted + status.untracked})`
      : 'Files';
  }
  if ($('history-view')) $('history-view').disabled = !status.gitAvailable;

  if ($('file-list')) {
    $('file-list').innerHTML = renderEntries(status.files, 0);
  }
}

function toggleTheme() {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
}

function applyTheme(theme, options = {}) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  if (options.persist !== false) {
    localStorage.setItem('mindgit-theme', theme);
  }
  const themeToggle = $('theme-toggle');
  if (themeToggle) {
    const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    themeToggle.textContent = theme === 'dark' ? '☀' : '☾';
    themeToggle.title = window.t ? window.t(label) : label;
    themeToggle.setAttribute('aria-label', themeToggle.title);
  }
  const darkStyle = $('hljs-dark');
  const lightStyle = $('hljs-light');
  if (theme === 'dark') {
    if (darkStyle) darkStyle.disabled = false;
    if (lightStyle) lightStyle.disabled = true;
  } else {
    if (darkStyle) darkStyle.disabled = true;
    if (lightStyle) lightStyle.disabled = false;
  }
  if (options.notifySplit !== false) {
    notifySplitTheme();
  }
  if (typeof syncTerminalTheme === 'function') {
    syncTerminalTheme();
  }
}

function currentInteractionTarget() {
  if (state.mode === 'edit') {
    return $('editor') || $('viewer')?.querySelector('.structured-source') || null;
  }
  return $('markdown-viewer-scroll')
    || $('code-viewer-scroll')
    || $('large-text-viewer')
    || $('viewer')?.querySelector('pre')
    || $('image-viewer')
    || $('viewer')?.querySelector('.structured-source')
    || $('viewer')?.querySelector('.mxgraph-canvas, .mindmap-canvas, .xmind-sheets')
    || null;
}

function focusWithoutScroll(target) {
  if (!target || typeof target.focus !== 'function') return;
  try {
    target.focus({ preventScroll: true });
  } catch {
    target.focus();
  }
}

function focusCurrentInteractionWindow() {
  try {
    window.focus?.();
  } catch {}
}

function focusSplitIframeElement() {
  const iframe = $('split-pane-iframe');
  if (!iframe) return;
  focusWithoutScroll(iframe);
  try {
    iframe.contentWindow?.focus?.();
  } catch {}
}

function restoreInteractionAfterResize(options = {}) {
  focusCurrentInteractionWindow();
  const target = currentInteractionTarget();
  if (target) {
    focusWithoutScroll(target);
    requestAnimationFrame(() => focusWithoutScroll(target));
  }
  if (!state.embed && options.notifySplit !== false && state.splitPane.open) {
    focusSplitIframeElement();
    splitIframeWindow()?.postMessage({ type: 'mindgit:restore-interaction' }, window.location.origin);
  }
}

function findInteractionTargetFromNode(startNode) {
  if (!(startNode instanceof Element)) return null;
  return startNode.closest('#editor, #markdown-viewer-scroll, #code-viewer-scroll, #image-viewer, #viewer > pre, .structured-source, .mxgraph-canvas, .mindmap-canvas, .xmind-sheets');
}

function syncInteractionTargetFromWheel(event) {
  const target = findInteractionTargetFromNode(event.target);
  if (!target) return;
  focusCurrentInteractionWindow();
  focusWithoutScroll(target);
}

function syncInteractionTargetFromPointer(event) {
  const target = findInteractionTargetFromNode(event.target);
  if (!target) return;
  focusCurrentInteractionWindow();
  focusWithoutScroll(target);
}

function setLinkOpenModifierHint(active) {
  document.documentElement.dataset.linkOpenModifier = active ? 'true' : 'false';
}

function clearLinkOpenModifierHint() {
  setLinkOpenModifierHint(false);
}

function escapeSelectorValue(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/[^A-Za-z0-9_-]/g, '\\$&');
}

function revealMarkdownAnchor(hash) {
  const targetId = decodeURIComponent(String(hash || '').replace(/^#/, ''));
  if (!targetId) return;
  requestAnimationFrame(() => {
    const anchor = $('viewer')?.querySelector(`#${escapeSelectorValue(targetId)}`);
    anchor?.scrollIntoView({ block: 'start' });
  });
}

async function handleViewerLinkClick(event) {
  if (event.defaultPrevented || event.button !== 0) return;
  if (!(event.target instanceof Element)) return;

  const anchor = event.target.closest('#viewer a[href]');
  if (!anchor) return;

  const isModifiedOpen = hasOpenLinkModifier(event);
  const localPath = anchor.dataset.mindgitPath || '';
  const hash = anchor.dataset.mindgitHash || anchor.hash?.slice(1) || '';

  if (localPath) {
    event.preventDefault();
    if (isModifiedOpen) {
      window.open(anchor.href, '_blank', 'noopener');
      return;
    }
    await selectFile(localPath, { mode: 'full', restoreState: false });
    if (hash) revealMarkdownAnchor(hash);
    return;
  }

  if (!isModifiedOpen) return;
  event.preventDefault();
  window.open(anchor.href, '_blank', 'noopener');
}

async function setMode(mode) {
  if (state.view === 'history') return;
  if (!state.selected) return;
  if ((isExternalTab(state.selected) && mode === 'diff') || (mode === 'edit' && !tabIsWritable(state.selected))) return;
  saveCurrentTabState();
  if (state.mode === 'edit' && mode !== 'edit') {
    await saveFile();
  }
  state.mode = mode;
  syncLayoutState();
  renderFileTabs();
  await renderSelected();
  renderFileTabs();
  restoreTabState(state.selected);
  saveWorkspaceState();
  notifyEmbedState();
}

function splitSrc(pane) {
  const params = new URLSearchParams({
    embed: '1',
    project: state.currentProjectKey,
    path: pane.selectedPath,
    mode: pane.mode,
    split: pane.orientation,
    tabs: JSON.stringify(pane.tabs),
    ts: String(Date.now()),
  });
  return `/?${params.toString()}`;
}

async function applyEmbedState(payload = {}) {
  if (!state.embed) return false;

  const nextProjectKey = typeof payload.projectKey === 'string' ? payload.projectKey : '';
  const nextTabs = uniquePaths(payload.tabs);
  const nextSelectedPath = typeof payload.selectedPath === 'string'
    ? payload.selectedPath
    : nextTabs[0] || '';
  const nextMode = normalizeMode(payload.mode);
  const projectChanged = Boolean(nextProjectKey && nextProjectKey !== state.currentProjectKey);

  if (projectChanged) {
    state.currentProjectKey = nextProjectKey;
    state.status = null;
    state.children = new Map();
    state.expandedGroups = new Set();
    state.history = [];
    state.selectedCommit = null;
    state.commitFiles = [];
    state.selectedCommitFile = null;
    state.tabStates = {};
    state.tabDrafts = {};
    state.tabOriginals = {};
    updateProjectSwitcher();
  }

  state.openTabs = nextTabs;

  if (!nextSelectedPath) {
    state.selected = null;
    state.mode = 'full';
    state.mobileViewerExpanded = false;
    state.editorReady = false;
    syncLayoutState();
    renderFileTabs();
    $('viewer').innerHTML = '<div class="empty">No file selected</div>';
    return true;
  }

  if (projectChanged || state.selected !== nextSelectedPath) {
    await selectFile(nextSelectedPath, { mode: nextMode, restoreState: false });
    return true;
  }

  renderFileTabs();
  if (state.mode !== nextMode) {
    await setMode(nextMode);
    return true;
  }

  saveWorkspaceState();
  return true;
}

function cleanupSplitPaneResizeObserver() {
  splitPaneResizeObserver?.disconnect();
  splitPaneResizeObserver = null;
}

function persistWorkspaceBeforeUnload() {
  saveCurrentTabState();
  saveWorkspaceState();
  cleanupSplitPaneResizeObserver();
}

function syncSplitIframeViewport(iframe) {
  const doc = iframe?.contentDocument;
  if (!doc) return;

  doc.documentElement.style.height = '100%';
  doc.documentElement.style.minHeight = '0';
  doc.documentElement.style.width = '100%';
  doc.documentElement.style.overflow = 'hidden';
  doc.body.style.height = '100%';
  doc.body.style.minHeight = '0';
  doc.body.style.width = '100%';
  doc.body.style.overflow = 'hidden';
  const view = doc.defaultView;
  if (view) view.dispatchEvent(new view.Event('resize'));
}

function observeSplitIframeViewport(iframe) {
  cleanupSplitPaneResizeObserver();
  if (!iframe || typeof ResizeObserver === 'undefined') return;

  splitPaneResizeObserver = new ResizeObserver(() => {
    syncSplitIframeViewport(iframe);
  });
  splitPaneResizeObserver.observe(iframe);
}

function setSplitIframeLoaded(iframe, loaded) {
  if (!iframe) return;
  iframe.style.visibility = loaded ? 'visible' : 'hidden';
  iframe.dataset.loaded = loaded ? 'true' : 'false';
  iframe.parentElement?.classList.toggle('is-loading', !loaded);
}

function ensureSplitIframe() {
  const host = $('split-pane-host');
  if (!host) return null;

  let iframe = $('split-pane-iframe');
  if (iframe) return iframe;

  host.innerHTML = `
    <div class="split-pane-frame is-loading" id="split-pane-frame">
      <iframe
        class="split-pane-iframe"
        id="split-pane-iframe"
        tabindex="-1"
        title="Split Pane"
        src="${escapeAttr(splitSrc(state.splitPane))}">
      </iframe>
    </div>`;

  iframe = $('split-pane-iframe');
  setSplitIframeLoaded(iframe, false);
  observeSplitIframeViewport(iframe);
  iframe?.addEventListener('load', () => {
    syncSplitIframeViewport(iframe);
    notifySplitEmbedState();
    const content = editorContentFor(state.splitPane.selectedPath);
    if (content !== null) {
      broadcastEditorContent(state.splitPane.selectedPath, content);
    }
    notifySplitTheme();
    setSplitIframeLoaded(iframe, true);
    syncViewerHeight();
  });
  return iframe;
}

function renderSplitPane() {
  const host = $('split-pane-host');
  const area = $('viewer-split-area');
  const resizer = $('split-pane-resizer');
  if (!host || !area) return;

  const splitVisible = state.view === 'worktree' && state.splitPane.open;
  area.classList.toggle('split-open', splitVisible);
  area.classList.toggle('split-right', splitVisible && state.splitPane.orientation === 'right');
  area.classList.toggle('split-down', splitVisible && state.splitPane.orientation === 'down');

  if (!splitVisible || !state.splitPane.selectedPath) {
    cleanupSplitPaneResizeObserver();
    host.hidden = true;
    if (resizer) resizer.hidden = true;
    host.innerHTML = '';
    syncViewerHeight();
    return;
  }

  host.hidden = false;
  if (resizer) resizer.hidden = false;
  const iframe = ensureSplitIframe();
  syncSplitIframeViewport(iframe);
  notifySplitEmbedState();
  notifySplitTheme();
  const content = editorContentFor(state.splitPane.selectedPath);
  if (content !== null) {
    broadcastEditorContent(state.splitPane.selectedPath, content);
  }
  syncViewerHeight();
}

function openSplitPane(orientation, path = state.selected) {
  if (!path || state.embed) return;
  const paneMode = normalizeMode(path === state.selected ? state.mode : state.tabStates[path]?.mode);
  const shouldAppend = state.splitPane.open && state.splitPane.orientation === orientation;
  state.splitPane.open = true;
  state.splitPane.orientation = orientation;
  state.splitPane.tabs = shouldAppend ? uniquePaths([...state.splitPane.tabs, path]) : [path];
  state.splitPane.selectedPath = path;
  state.splitPane.mode = paneMode;
  syncLayoutState();
  renderSplitPane();
  saveWorkspaceState();
}

function closeSplitPane() {
  cleanupSplitPaneResizeObserver();
  state.splitPane.open = false;
  state.splitPane.selectedPath = '';
  state.splitPane.tabs = [];
  syncLayoutState();
  renderSplitPane();
  saveWorkspaceState();
}

function handleSplitPaneMessage(event) {
  if (handleThemeMessage(event)) return;
  if (handleFileContentMessage(event)) return;
  if (event.origin !== window.location.origin) return;
  const data = event.data || {};
  if (data.type === 'mindgit:embed-state') {
    applyEmbedState(data.payload);
    return;
  }
  if (data.type === 'mindgit:restore-interaction') {
    restoreInteractionAfterResize({ notifySplit: false });
    return;
  }
  if (state.embed) return;
  if (data.type === 'mindgit:close-split') {
    closeSplitPane();
    return;
  }
  if (data.type !== 'mindgit:split-state' || !state.splitPane.open) return;
  const payload = data.payload || {};
  state.splitPane.tabs = uniquePaths(payload.tabs);
  state.splitPane.selectedPath = typeof payload.selectedPath === 'string'
    ? payload.selectedPath
    : state.splitPane.tabs[0] || '';
  if (!state.splitPane.selectedPath && state.splitPane.tabs.length === 0) {
    closeSplitPane();
    return;
  }
  state.splitPane.mode = normalizeMode(payload.mode);
  saveWorkspaceState();
}

function handleThemeMessage(event) {
  if (event.origin !== window.location.origin) return false;
  const data = event.data || {};
  if (data.type !== 'mindgit:theme') return false;
  const theme = data.payload?.theme;
  if (theme === 'dark' || theme === 'light') {
    applyTheme(theme, { notifySplit: false, persist: false });
  }
  return true;
}

function setupResizer(id, onPointerDown) {
  const el = $(id);
  if (!el) return;
  el.addEventListener('pointerdown', onPointerDown);
}

function startResize(event, move, done, axis = 'col') {
  const target = event.currentTarget;
  const pointerId = event.pointerId;
  let finished = false;
  event.preventDefault();
  target?.setPointerCapture?.(pointerId);
  document.body.classList.add('is-resizing');
  document.body.classList.add(axis === 'row' ? 'is-resizing-row' : 'is-resizing-col');

  const finish = () => {
    if (finished) return;
    finished = true;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    window.removeEventListener('mouseup', finish, true);
    window.removeEventListener('blur', finish);
    target?.removeEventListener?.('lostpointercapture', finish);
    document.body.classList.remove('is-resizing');
    document.body.classList.remove('is-resizing-row', 'is-resizing-col');
    try {
      target?.releasePointerCapture?.(pointerId);
    } catch {}
    syncViewerHeight();
    restoreInteractionAfterResize();
    done();
  };

  target?.addEventListener?.('lostpointercapture', finish);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
  window.addEventListener('mouseup', finish, true);
  window.addEventListener('blur', finish);
}

function setupDesktopResizers() {
  setupResizer('left-pane-resizer', (event) => {
    if (window.innerWidth <= 900 || state.embed) return;
    const startX = event.clientX;
    const startWidth = state.layout.leftPaneWidth;

    const move = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      state.layout.leftPaneWidth = clamp(startWidth + delta, 180, 420);
      applyLayoutVars();
    };
    startResize(event, move, saveLayoutPrefs, 'col');
  });

  setupResizer('right-pane-resizer', (event) => {
    if (window.innerWidth <= 900 || state.embed) return;
    const startX = event.clientX;
    const startWidth = state.layout.rightPaneWidth;

    const move = (moveEvent) => {
      const delta = startX - moveEvent.clientX;
      state.layout.rightPaneWidth = clamp(startWidth + delta, 200, 480);
      applyLayoutVars();
    };
    startResize(event, move, saveLayoutPrefs, 'col');
  });

  setupResizer('split-pane-resizer', (event) => {
    if (window.innerWidth <= 900 || state.embed || !state.splitPane.open) return;
    const area = $('viewer-split-area');
    if (!area) return;
    const rect = area.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startRatio = state.splitPane.orientation === 'right'
      ? state.layout.splitRatioRight
      : state.layout.splitRatioDown;

    const move = (moveEvent) => {
      if (state.splitPane.orientation === 'right') {
        const delta = (moveEvent.clientX - startX) / rect.width;
        state.layout.splitRatioRight = clamp(startRatio + delta, 0.25, 0.75);
      } else {
        const delta = (moveEvent.clientY - startY) / rect.height;
        state.layout.splitRatioDown = clamp(startRatio + delta, 0.25, 0.75);
      }
      applyLayoutVars();
      syncSplitIframeViewport($('split-pane-iframe'));
      syncViewerHeight();
    };
    startResize(
      event,
      move,
      saveLayoutPrefs,
      state.splitPane.orientation === 'down' ? 'row' : 'col',
    );
  });
}

applyTheme(state.theme, { persist: false });
syncLayoutState();
if ($('worktree-view')) $('worktree-view').addEventListener('click', () => setView('worktree'));
if ($('history-view')) $('history-view').addEventListener('click', () => setView('history'));
if ($('theme-toggle')) $('theme-toggle').addEventListener('click', toggleTheme);
if ($('runtime-stats')) $('runtime-stats').addEventListener('click', openRuntimeStats);
if ($('runtime-close')) $('runtime-close').addEventListener('click', closeRuntimeStats);
if ($('runtime-processes')) $('runtime-processes').addEventListener('click', (event) => {
  const button = event.target.closest('.runtime-process-close');
  if (button) closeRuntimeProcess(button.dataset.processId);
});
if ($('runtime-dialog')) $('runtime-dialog').addEventListener('click', (event) => {
  if (event.target === $('runtime-dialog')) closeRuntimeStats();
});
if ($('refresh')) $('refresh').addEventListener('click', refreshWorkspaceOutline);
if ($('project-switcher')) $('project-switcher').addEventListener('click', (event) => {
  event.stopPropagation();
  openProjectMenu(event.currentTarget);
});
if ($('tree-root-menu')) $('tree-root-menu').addEventListener('click', (event) => {
  event.stopPropagation();
  if (state.view !== 'worktree') return;
  openTreeMenu(event.currentTarget, '', 'dir');
});
if ($('file-list')) $('file-list').addEventListener('click', handleTreeClick);
if ($('search-form')) $('search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  search();
});
if ($('search')) $('search').addEventListener('input', (event) => {
  if (!event.currentTarget.value.trim()) {
    $('search-results').innerHTML = '<p>Enter a keyword to search the project.</p>';
  }
});
window.addEventListener('message', handleSplitPaneMessage);
window.addEventListener('beforeunload', persistWorkspaceBeforeUnload);
window.addEventListener('pagehide', persistWorkspaceBeforeUnload);
window.addEventListener('resize', syncViewerHeight);
window.addEventListener('resize', scheduleProjectSwitcherLabelSync);
window.addEventListener('blur', clearLinkOpenModifierHint);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearLinkOpenModifierHint();
});
document.addEventListener('keydown', (event) => setLinkOpenModifierHint(hasOpenLinkModifier(event)), true);
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'f') return;
  if (state.mode !== 'full' || !showFullViewerFindBar()) return;
  event.preventDefault();
  event.stopPropagation();
}, true);
document.addEventListener('keyup', (event) => setLinkOpenModifierHint(hasOpenLinkModifier(event)), true);
document.addEventListener('click', handleViewerLinkClick, true);
document.addEventListener('wheel', syncInteractionTargetFromWheel, { capture: true, passive: true });
document.addEventListener('pointerdown', syncInteractionTargetFromPointer, true);
setupDesktopResizers();
clearLinkOpenModifierHint();

if (systemThemeMediaQuery) {
  const syncSystemTheme = (event) => {
    if (storedThemePreference()) return;
    applyTheme(event.matches ? 'dark' : 'light', { persist: false });
  };
  if (typeof systemThemeMediaQuery.addEventListener === 'function') {
    systemThemeMediaQuery.addEventListener('change', syncSystemTheme);
  } else if (typeof systemThemeMediaQuery.addListener === 'function') {
    systemThemeMediaQuery.addListener(syncSystemTheme);
  }
}

async function bootstrap() {
  await ensureAuthenticated();
  await loadProjects();
  await loadSSHConnections();
  await refresh();
  if (state.embed) {
    const initialTabs = parseInitialTabs();
    const initialPath = state.initialPath || initialTabs[0] || '';
    if (initialTabs.length) {
      state.openTabs = initialTabs;
    }
    if (initialPath) {
      await selectFile(initialPath, { mode: normalizeMode(state.initialMode), restoreState: false });
    }
  }
  renderSplitPane();
  requestAnimationFrame(syncViewerHeight);
}

bootstrap().catch((error) => setMessage(error.message, 'error'));
