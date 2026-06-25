const state = {
  view: 'worktree',
  status: null,
  selected: null,
  mode: 'full',
  embed: new URLSearchParams(window.location.search).get('embed') === '1',
  initialPath: new URLSearchParams(window.location.search).get('path') || '',
  initialMode: new URLSearchParams(window.location.search).get('mode') || '',
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
  theme: localStorage.getItem('mindgit-theme') || 'dark',
  expandedGroups: new Set(),
  children: new Map(),
  history: [],
  selectedCommit: null,
  commitFiles: [],
  selectedCommitFile: null,
  wordWrap: localStorage.getItem('mindgit-wordwrap') === 'true',
  openTabs: [],
  tabStates: {},
};

const $ = (id) => document.getElementById(id);

const layoutStorageKey = 'mindgit-layout-v1';
const workspaceStorageKey = 'mindgit-workspace-v1';

function normalizeMode(mode) {
  return ['diff', 'full', 'edit'].includes(mode) ? mode : 'full';
}

function uniquePaths(paths) {
  if (!Array.isArray(paths)) return [];
  return [...new Set(paths.filter((path) => typeof path === 'string' && path.trim()))];
}

function loadWorkspaceState() {
  if (state.embed) return null;
  try {
    const raw = localStorage.getItem(workspaceStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const splitPane = parsed.splitPane || {};
    const selectedPath = typeof splitPane.selectedPath === 'string'
      ? splitPane.selectedPath
      : typeof splitPane.path === 'string'
        ? splitPane.path
        : '';
    const splitTabs = uniquePaths([...(splitPane.tabs || []), selectedPath]);
    const openTabs = uniquePaths([...(parsed.openTabs || []), parsed.selected]);
    return {
      selected: typeof parsed.selected === 'string' ? parsed.selected : null,
      mode: normalizeMode(parsed.mode),
      mobileViewerExpanded: Boolean(parsed.mobileViewerExpanded),
      openTabs,
      tabStates: parsed.tabStates && typeof parsed.tabStates === 'object' ? parsed.tabStates : {},
      splitPane: {
        open: Boolean(splitPane.open && selectedPath),
        orientation: splitPane.orientation === 'down' ? 'down' : 'right',
        tabs: splitTabs,
        selectedPath,
        mode: normalizeMode(splitPane.mode),
      },
    };
  } catch {
    return null;
  }
}

function applyWorkspaceState() {
  const saved = loadWorkspaceState();
  if (!saved) return;
  state.selected = saved.selected;
  state.mode = saved.mode;
  state.mobileViewerExpanded = saved.mobileViewerExpanded;
  state.openTabs = saved.openTabs;
  state.tabStates = saved.tabStates;
  state.splitPane = saved.splitPane;
}

function saveWorkspaceState() {
  if (state.embed) return;
  localStorage.setItem(workspaceStorageKey, JSON.stringify({
    selected: state.selected,
    mode: state.mode,
    mobileViewerExpanded: state.mobileViewerExpanded,
    openTabs: state.openTabs,
    tabStates: state.tabStates,
    splitPane: state.splitPane,
  }));
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

  state.content = content;
  const editor = $('editor');
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
    return uniquePaths(JSON.parse(new URLSearchParams(window.location.search).get('tabs') || '[]'));
  } catch {
    return [];
  }
}

applyWorkspaceState();

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
  document.documentElement.dataset.splitOpen = state.splitPane.open ? 'true' : 'false';
  document.documentElement.dataset.splitOrientation = state.splitPane.orientation;

  const rootMenuButton = $('tree-root-menu');
  if (rootMenuButton) rootMenuButton.hidden = state.view !== 'worktree';
}

async function api(path, options) {
  const response = await fetch(path, {
    cache: 'no-store',
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

async function setView(view) {
  if (state.view === view) return;
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
      $('viewer').innerHTML = `<div class="empty">${state.status.files.length ? 'Expand a directory and select a changed file' : 'Working tree clean'}</div>`;
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
  if ($('root')) $('root').textContent = status.root;
  if ($('branch')) $('branch').textContent = status.branch;
  if ($('modified')) $('modified').textContent = status.modified;
  if ($('added')) $('added').textContent = status.added + status.untracked;
  if ($('deleted')) $('deleted').textContent = status.deleted;
  if ($('lines')) $('lines').textContent = `+${status.additions} -${status.deletions}`;
  if ($('change-title')) $('change-title').textContent = `Changes (${status.modified + status.added + status.deleted + status.untracked})`;

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
  localStorage.setItem('mindgit-theme', theme);
  $('theme-toggle').textContent = theme === 'dark' ? 'Light' : 'Dark';
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
}

async function setMode(mode) {
  if (state.view === 'history') return;
  if (!state.selected) return;
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
    path: pane.selectedPath,
    mode: pane.mode,
    split: pane.orientation,
    tabs: JSON.stringify(pane.tabs),
    ts: String(Date.now()),
  });
  return `/?${params.toString()}`;
}

function renderSplitPane() {
  const host = $('split-pane-host');
  const area = $('viewer-split-area');
  const resizer = $('split-pane-resizer');
  if (!host || !area) return;

  const splitVisible = state.view === 'worktree' && state.splitPane.open;
  area.classList.toggle('split-open', splitVisible);
  area.classList.toggle('split-right', state.splitPane.open && state.splitPane.orientation === 'right');
  area.classList.toggle('split-down', state.splitPane.open && state.splitPane.orientation === 'down');

  if (!splitVisible || !state.splitPane.selectedPath) {
    host.hidden = true;
    if (resizer) resizer.hidden = true;
    host.innerHTML = '';
    return;
  }

  host.hidden = false;
  if (resizer) resizer.hidden = false;
  host.innerHTML = `
    <div class="split-pane-frame">
      <iframe
        class="split-pane-iframe"
        id="split-pane-iframe"
        title="Split Pane"
        src="${escapeAttr(splitSrc(state.splitPane))}">
      </iframe>
    </div>`;

  const iframe = $('split-pane-iframe');
  iframe?.addEventListener('load', () => {
    const content = editorContentFor(state.splitPane.selectedPath);
    if (content !== null) {
      broadcastEditorContent(state.splitPane.selectedPath, content);
    }
    notifySplitTheme();
  });
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
  if (state.embed || event.origin !== window.location.origin) return;
  const data = event.data || {};
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
    applyTheme(theme, { notifySplit: false });
  }
  return true;
}

function setupResizer(id, onPointerDown) {
  const el = $(id);
  if (!el) return;
  el.addEventListener('pointerdown', onPointerDown);
}

function startResize(event, move, done) {
  const target = event.currentTarget;
  event.preventDefault();
  target?.setPointerCapture?.(event.pointerId);
  document.body.classList.add('is-resizing');

  const finish = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    document.body.classList.remove('is-resizing');
    target?.releasePointerCapture?.(event.pointerId);
    done();
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
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
    startResize(event, move, saveLayoutPrefs);
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
    startResize(event, move, saveLayoutPrefs);
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
    };
    startResize(event, move, saveLayoutPrefs);
  });
}

applyTheme(state.theme);
syncLayoutState();
if ($('worktree-view')) $('worktree-view').addEventListener('click', () => setView('worktree'));
if ($('history-view')) $('history-view').addEventListener('click', () => setView('history'));
if ($('theme-toggle')) $('theme-toggle').addEventListener('click', toggleTheme);
if ($('refresh')) $('refresh').addEventListener('click', refreshWorkspaceOutline);
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
window.addEventListener('message', handleSplitPaneMessage);
setupDesktopResizers();

async function bootstrap() {
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
}

bootstrap();
