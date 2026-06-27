const systemThemeMediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function storedThemePreference() {
  const theme = localStorage.getItem('mindgit-theme');
  return theme === 'dark' || theme === 'light' ? theme : null;
}

function systemThemePreference() {
  return systemThemeMediaQuery?.matches ? 'dark' : 'light';
}

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
};

const $ = (id) => document.getElementById(id);

const layoutStorageKey = 'mindgit-layout-v1';
const workspaceStorageKey = 'mindgit-workspace-v1';
let splitPaneResizeObserver = null;

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

function notifySplitEmbedState() {
  if (state.embed || !state.splitPane.open) return;
  const target = splitIframeWindow();
  if (!target) return;
  target.postMessage({
    type: 'mindgit:embed-state',
    payload: {
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
  document.documentElement.dataset.splitOpen = state.splitPane.open ? 'true' : 'false';
  document.documentElement.dataset.splitOrientation = state.splitPane.orientation;
  syncViewerHeight();

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
  document.documentElement.style.colorScheme = theme;
  if (options.persist !== false) {
    localStorage.setItem('mindgit-theme', theme);
  }
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

function currentInteractionTarget() {
  if (state.mode === 'edit') {
    return $('editor') || $('viewer')?.querySelector('.structured-source') || null;
  }
  return $('code-viewer-scroll')
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
  return startNode.closest('#editor, #code-viewer-scroll, #image-viewer, #viewer > pre, .structured-source, .mxgraph-canvas, .mindmap-canvas, .xmind-sheets');
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

async function applyEmbedState(payload = {}) {
  if (!state.embed) return false;

  const nextTabs = uniquePaths(payload.tabs);
  const nextSelectedPath = typeof payload.selectedPath === 'string'
    ? payload.selectedPath
    : nextTabs[0] || '';
  const nextMode = normalizeMode(payload.mode);

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

  if (state.selected !== nextSelectedPath) {
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
  area.classList.toggle('split-right', state.splitPane.open && state.splitPane.orientation === 'right');
  area.classList.toggle('split-down', state.splitPane.open && state.splitPane.orientation === 'down');

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
window.addEventListener('beforeunload', cleanupSplitPaneResizeObserver);
window.addEventListener('resize', syncViewerHeight);
document.addEventListener('wheel', syncInteractionTargetFromWheel, { capture: true, passive: true });
document.addEventListener('pointerdown', syncInteractionTargetFromPointer, true);
setupDesktopResizers();

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

bootstrap();
