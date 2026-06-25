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
  document.documentElement.dataset.mobileExpanded = state.mobileViewerExpanded ? 'true' : 'false';
  document.documentElement.dataset.embed = state.embed ? 'true' : 'false';
  document.documentElement.dataset.splitOpen = state.splitPane.open ? 'true' : 'false';
  document.documentElement.dataset.splitOrientation = state.splitPane.orientation;

  const mobileToggle = $('mobile-viewer-toggle');
  if (mobileToggle) {
    const visible = !state.embed && state.view === 'worktree' && Boolean(state.selected);
    mobileToggle.hidden = !visible;
    mobileToggle.textContent = state.mobileViewerExpanded ? '收起' : '展开';
    mobileToggle.setAttribute('aria-pressed', state.mobileViewerExpanded ? 'true' : 'false');
  }

  const desktopControlsVisible = !state.embed && state.view === 'worktree' && Boolean(state.selected);
  const splitRightButton = $('split-right-tab');
  const splitDownButton = $('split-down-tab');
  if (splitRightButton) splitRightButton.hidden = !desktopControlsVisible;
  if (splitDownButton) splitDownButton.hidden = !desktopControlsVisible;
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
  state.view = view;
  state.selected = null;
  state.selectedCommitFile = null;
  state.mode = 'diff';
  state.mobileViewerExpanded = false;
  state.openTabs = [];
  state.splitPane.open = false;
  state.splitPane.selectedPath = '';
  state.splitPane.tabs = [];
  syncLayoutState();
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

function applyTheme(theme) {
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
}

async function setMode(mode) {
  if (state.view === 'history') return;
  if (!state.selected) return;
  if (state.mode === 'edit' && mode !== 'edit') {
    await saveFile();
  }
  saveCurrentTabState();
  state.mode = mode;
  syncLayoutState();
  await renderSelected();
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

  area.classList.toggle('split-open', state.splitPane.open);
  area.classList.toggle('split-right', state.splitPane.open && state.splitPane.orientation === 'right');
  area.classList.toggle('split-down', state.splitPane.open && state.splitPane.orientation === 'down');

  if (!state.splitPane.open || !state.splitPane.selectedPath) {
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
}

function openSplitPane(orientation) {
  if (!state.selected || state.embed) return;
  const paneMode = normalizeMode(state.mode);
  const shouldAppend = state.splitPane.open && state.splitPane.orientation === orientation;
  state.splitPane.open = true;
  state.splitPane.orientation = orientation;
  state.splitPane.tabs = shouldAppend ? uniquePaths([...state.splitPane.tabs, state.selected]) : [state.selected];
  state.splitPane.selectedPath = state.selected;
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
  state.splitPane.mode = normalizeMode(payload.mode);
  saveWorkspaceState();
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
if ($('refresh')) $('refresh').addEventListener('click', refresh);
if ($('diff-tab')) $('diff-tab').addEventListener('click', () => setMode('diff'));
if ($('full-tab')) $('full-tab').addEventListener('click', () => setMode('full'));
if ($('edit-tab')) $('edit-tab').addEventListener('click', async () => {
  await setMode('edit');
});
if ($('save-tab')) $('save-tab').addEventListener('click', async () => {
  if (state.saveInProgress) return;
  await saveFile();
});
if ($('mobile-viewer-toggle')) $('mobile-viewer-toggle').addEventListener('click', () => {
  state.mobileViewerExpanded = !state.mobileViewerExpanded;
  syncLayoutState();
  saveWorkspaceState();
});
if ($('split-right-tab')) $('split-right-tab').addEventListener('click', () => openSplitPane('right'));
if ($('split-down-tab')) $('split-down-tab').addEventListener('click', () => openSplitPane('down'));
if ($('embed-close-tab')) $('embed-close-tab').addEventListener('click', () => {
  if (!state.embed || !window.parent) return;
  window.parent.postMessage({ type: 'mindgit:close-split' }, window.location.origin);
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
