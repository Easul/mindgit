async function refreshLoadedGroups() {
  const groups = [...state.expandedGroups].filter(Boolean);
  if (groups.length === 0) return;

  try {
    const refreshed = await loadTreePaths(groups);
    for (const [group, files] of refreshed) {
      state.children.set(group, files);
    }
  } catch (error) {
    if (!isMissingPathError(error)) throw error;

    for (const group of groups) {
      try {
        const refreshed = await loadTreePaths([group]);
        state.children.set(group, refreshed.get(group) || []);
      } catch (groupError) {
        if (!isMissingPathError(groupError)) throw groupError;
        removeUnavailablePath(group);
      }
    }
  }
}

function isMissingPathError(error) {
  return /no such file|not exist|cannot find/i.test(error?.message || '');
}

function removeUnavailablePath(path) {
  const isUnavailable = (candidate) => candidate && isPathInside(candidate, path);

  state.openTabs = state.openTabs.filter((tabPath) => !isUnavailable(tabPath));
  for (const tabPath of Object.keys(state.tabStates)) {
    if (isUnavailable(tabPath)) delete state.tabStates[tabPath];
  }
  for (const tabPath of Object.keys(state.tabDrafts)) {
    if (isUnavailable(tabPath)) delete state.tabDrafts[tabPath];
  }
  for (const group of [...state.expandedGroups]) {
    if (isUnavailable(group)) state.expandedGroups.delete(group);
  }
  for (const group of [...state.children.keys()]) {
    if (isUnavailable(group)) state.children.delete(group);
  }

  if (isUnavailable(state.selected)) {
    state.selected = null;
    state.mode = 'full';
    state.mobileViewerExpanded = false;
    state.editorReady = false;
  }

  state.splitPane.tabs = state.splitPane.tabs.filter((tabPath) => !isUnavailable(tabPath));
  if (isUnavailable(state.splitPane.selectedPath)) {
    state.splitPane.selectedPath = state.splitPane.tabs[0] || '';
  }
  if (!state.splitPane.selectedPath) {
    state.splitPane.open = false;
    state.splitPane.tabs = [];
  }

  saveWorkspaceState();
  notifyEmbedState();
}

async function loadTreePaths(paths) {
  const unique = [...new Set(paths.filter((path) => typeof path === 'string'))];
  if (unique.length === 0) return new Map();

  const params = new URLSearchParams();
  for (const path of unique) {
    params.append('path', path);
  }

  const response = await api(`/api/tree-batch?${params.toString()}`);

  return new Map((response.trees || []).map((tree) => [tree.path, tree.files || []]));
}

function renderEntries(entries, depth) {
  return `<div class="tree">${entries.map((entry) => entry.isDir ? renderDirectory(entry, depth) : renderFile(entry, depth)).join('')}</div>`;
}

function renderDirectory(dir, depth) {
  const expanded = state.expandedGroups.has(dir.path);
  const children = state.children.get(dir.path) || [];
  return `
    <div>
      <div class="tree-row">
        <button class="group-name ${dir.ignored ? 'ignored' : ''}" type="button" data-group="${escapeAttr(dir.path)}" style="--depth: ${depth}">
          <span class="chevron ${expanded ? 'open' : ''}"></span>
          <span class="file-path">${escapeHTML(displayName(dir.path))}</span>
          ${isTreeChange(dir) ? `<span class="${fileStatusClasses(dir)}"><span class="status-dot"></span></span>` : ''}
        </button>
        <button class="tree-action" type="button" data-tree-menu data-tree-kind="dir" data-tree-path="${escapeAttr(dir.path)}" title="Folder actions">...</button>
      </div>
      ${expanded ? renderEntries(children, depth + 1) : ''}
    </div>`;
}

function renderFile(file, depth) {
  return `
    <div class="tree-row">
      <button class="file ${file.path === state.selected ? 'active' : ''} ${file.ignored ? 'ignored' : ''}" title="${escapeHTML(file.path)}" data-path="${escapeAttr(file.path)}" style="--depth: ${depth}">
        <span class="file-main">
          ${isChanged(file) ? `<span class="${fileStatusClasses(file)}">${fileStatusLabel(file)}</span>` : ''}
          <span class="file-path">${escapeHTML(displayName(file.path))}</span>
        </span>
        <span class="mini-stat">${isChanged(file) ? `+${file.additions} -${file.deletions}` : ''}</span>
      </button>
      <button class="tree-action" type="button" data-tree-menu data-tree-kind="file" data-tree-path="${escapeAttr(file.path)}" title="File actions">...</button>
    </div>`;
}

function displayName(path) {
  const parts = String(path || '').split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function isChanged(file) {
  return Boolean(file.status) && file.status !== 'I' && !file.ignored;
}

function isTreeChange(entry) {
  return Boolean(entry.status) && entry.status !== 'I';
}

async function handleTreeClick(event) {
  if (state.view === 'history') {
    const restore = event.target.closest('[data-restore-staged-path]');
    if (restore) {
      event.stopPropagation();
      await restoreStagedFile(restore.dataset.restoreStagedPath);
      return;
    }
    const commit = event.target.closest('[data-commit]');
    if (commit) {
      await selectCommit(commit.dataset.commit);
      return;
    }
    const file = event.target.closest('[data-commit-path]');
    if (file) {
      await selectCommitFile(file.dataset.commitPath);
    }
    return;
  }
  const treeMenu = event.target.closest('[data-tree-menu]');
  if (treeMenu) {
    event.stopPropagation();
    openTreeMenu(treeMenu, treeMenu.dataset.treePath || '', treeMenu.dataset.treeKind || 'dir');
    return;
  }
  const group = event.target.closest('[data-group]');
  if (group) {
    const dir = group.dataset.group;
    if (state.expandedGroups.has(dir)) {
      state.expandedGroups.delete(dir);
    } else {
      if (!state.children.has(dir)) {
        const trees = await loadTreePaths([dir]);
        state.children.set(dir, trees.get(dir) || []);
      }
      state.expandedGroups.add(dir);
    }
    renderStatus();
    saveWorkspaceState();
    return;
  }
  const file = event.target.closest('[data-path]');
  if (file) {
    await selectFile(file.dataset.path);
  }
}

function renderFileTabs() {
  const tabsContainer = $('file-tabs');
  if (!tabsContainer) return;

  if (state.view !== 'worktree' || state.openTabs.length === 0) {
    tabsContainer.innerHTML = '';
    tabsContainer.style.display = 'none';
    return;
  }

  tabsContainer.style.display = 'flex';
  tabsContainer.innerHTML = state.openTabs.map(path => {
    const temporary = isTemporaryTab(path);
    const external = isExternalTab(path);
    const displayPath = filePathForTab(path);
    const fileName = temporary
      ? state.temporaryTabs.get(path)?.name || 'Untitled'
      : displayName(displayPath);
    const isActive = path === state.selected;
    const mode = currentModeForPath(path);
    const menuIconMode = isActive && mode === 'edit' ? 'save' : mode;
    const menuLabel = menuIconMode === 'save' ? 'Save' : modeLabel(mode);
    return `
      <div class="file-tab ${isActive ? 'active' : ''} ${temporary ? 'temporary' : ''} ${external ? 'external' : ''}" title="${escapeHTML(temporary ? `${fileName} (temporary)` : `${displayPath}${external && !tabIsWritable(path) ? ' (read only)' : ''}`)}">
        <button class="file-tab-menu-button" type="button" data-tab-menu="${escapeAttr(path)}" title="${escapeAttr(menuLabel)} actions" aria-label="${escapeAttr(menuLabel)} actions for ${escapeAttr(fileName)}">
          ${modeIcon(menuIconMode)}
        </button>
        <button class="file-tab-select" type="button" data-tab-path="${escapeAttr(path)}">
          <span class="file-tab-name">${escapeHTML(fileName)}</span>
        </button>
        <button class="file-tab-close" type="button" data-close-tab="${escapeAttr(path)}" title="Close tab">x</button>
      </div>`;
  }).join('');

  tabsContainer.querySelectorAll('[data-tab-path]').forEach(tab => {
    tab.addEventListener('click', async (e) => {
      await selectTab(tab.dataset.tabPath);
    });
  });

  tabsContainer.querySelectorAll('[data-tab-menu]').forEach(menuBtn => {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTabMenu(menuBtn, menuBtn.dataset.tabMenu);
    });
  });

  tabsContainer.querySelectorAll('[data-close-tab]').forEach(closeBtn => {
    closeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await closeTab(closeBtn.dataset.closeTab);
    });
  });
}

async function closeTab(path) {
  let closingPath = path;
  const originalIndex = state.openTabs.indexOf(path);
  if (originalIndex === -1) return;

  if (isTemporaryTab(path)) {
    if (path === state.selected) saveCurrentTabState();
    const content = state.tabDrafts[path];
    if (typeof content === 'string' && content.length > 0) {
      const name = state.temporaryTabs.get(path)?.name || 'Untitled';
      const choice = await showSaveDiscardDialog({
        title: 'Save Temporary Tab?',
        message: `Save the contents of "${name}" before closing?`,
        saveLabel: 'Save',
        discardLabel: "Don't Save",
        cancelLabel: 'Cancel',
      });
      if (choice === null) return;
      if (choice === 'save') {
        if (!await saveTemporaryTab(path)) return;
        closingPath = state.openTabs[originalIndex];
        if (!closingPath) return;
      }
    }
  }

  await closeTabImmediately(closingPath);
}

async function closeTabImmediately(path) {
  const index = state.openTabs.indexOf(path);
  if (index === -1) return;
  const temporary = isTemporaryTab(path);

  if (path === state.selected) saveCurrentTabState();
  state.openTabs.splice(index, 1);
  delete state.tabDrafts[path];
  if (temporary) delete state.tabStates[path];
  state.temporaryTabs.delete(path);
  state.fileAccess.delete(path);

  if (path === state.selected) {
    if (state.openTabs.length > 0) {
      const newIndex = index > 0 ? index - 1 : 0;
      await selectTab(state.openTabs[newIndex]);
    } else {
      state.selected = null;
      state.mode = 'full';
      state.mobileViewerExpanded = false;
      state.editorReady = false;
      syncLayoutState();
      $('viewer').innerHTML = '<div class="empty">No file selected</div>';
      if ($('review-summary')) {
        $('review-summary').textContent = 'Select a file to view its change summary and quick actions.';
      }
      renderFileTabs();
      saveWorkspaceState();
      notifyEmbedState();
    }
  } else {
    renderFileTabs();
    saveWorkspaceState();
    notifyEmbedState();
  }
}

function saveCurrentTabState() {
  if (!state.selected) return;

  const editor = $('editor');
  const viewer = $('viewer');
  let scrollTop = 0;
  let scrollLeft = 0;

  if (viewer) {
    const scrollTarget = getViewerScrollTarget(viewer);
    if (scrollTarget) {
      scrollTop = scrollTarget.scrollTop;
      scrollLeft = scrollTarget.scrollLeft;
    } else {
      scrollTop = viewer.scrollTop;
      scrollLeft = viewer.scrollLeft;
    }
  }

  state.tabStates[state.selected] = {
    mode: state.mode,
    scrollTop,
    scrollLeft,
  };

  if (editor && state.mode === 'edit') {
    state.tabStates[state.selected].cursorStart = editor.selectionStart;
    state.tabStates[state.selected].cursorEnd = editor.selectionEnd;
    state.tabStates[state.selected].editorScrollTop = editor.scrollTop;
    state.tabStates[state.selected].editorScrollLeft = editor.scrollLeft;
    state.tabStates[state.selected].editorCommandState = captureEditorCommandState(editor);
  }

  if (state.mode === 'edit') {
    const structuredContent = structuredEditorContent();
    const draftContent = structuredContent !== null ? structuredContent : editor?.value;
    if (typeof draftContent === 'string') {
      state.tabDrafts[state.selected] = draftContent;
    }
  }

  const imageViewer = viewer?.querySelector('.image-viewer');
  if (imageViewer) {
    const img = imageViewer.querySelector('img');
    if (img && img.style.transform) {
      const transformMatch = img.style.transform.match(/translate\(([^,]+)px,\s*([^)]+)px\)\s*scale\(([^)]+)\)/);
      if (transformMatch) {
        state.tabStates[state.selected].imageTranslateX = parseFloat(transformMatch[1]);
        state.tabStates[state.selected].imageTranslateY = parseFloat(transformMatch[2]);
        state.tabStates[state.selected].imageScale = parseFloat(transformMatch[3]);
      }
    }
  }

  const pdfViewer = viewer?.querySelector('.pdf-viewer');
  if (pdfViewer) {
    state.tabStates[state.selected].pdfPage = Number(pdfViewer.dataset.pdfPage) || 1;
    state.tabStates[state.selected].pdfScale = Number(pdfViewer.dataset.pdfScale) || 1;
    state.tabStates[state.selected].pdfFitWidth = pdfViewer.dataset.pdfFitWidth !== 'false';
  }
}

function restoreTabState(path) {
  if (!state.tabStates[path]) return;

  const savedState = state.tabStates[path];

  if (savedState.imageScale !== undefined) {
    state._pendingImageState = {
      scale: savedState.imageScale,
      translateX: savedState.imageTranslateX,
      translateY: savedState.imageTranslateY
    };
  }

  setTimeout(() => {
    const editor = $('editor');
    const viewer = $('viewer');

    if (editor && savedState.cursorStart !== undefined) {
      editor.setSelectionRange(savedState.cursorStart, savedState.cursorEnd);
      if (savedState.editorScrollTop !== undefined) {
        editor.scrollTop = savedState.editorScrollTop;
        editor.scrollLeft = savedState.editorScrollLeft;
      }
      restoreEditorCommandState(editor, savedState.editorCommandState);
      editor.focus();
    }

    if (viewer && savedState.scrollTop !== undefined) {
      const scrollTarget = getViewerScrollTarget(viewer);
      if (scrollTarget) {
        scrollTarget.scrollTop = savedState.scrollTop;
        scrollTarget.scrollLeft = savedState.scrollLeft;
      } else {
        viewer.scrollTop = savedState.scrollTop;
        viewer.scrollLeft = savedState.scrollLeft;
      }
    }
  }, 100);
}

async function selectFile(path, options = {}) {
  saveCurrentTabState();

  try {
    if (!state.status) {
      state.status = await api('/api/status');
    }

    await ensureFileInfo(path);

    if (!state.openTabs.includes(path)) {
      state.openTabs.push(path);
    }

    state.selected = path;
    const savedState = options.restoreState === false ? null : state.tabStates[path];
    state.mode = options.mode || savedState?.mode || 'full';
    if ((isExternalTab(path) && state.mode === 'diff') || (state.mode === 'edit' && !tabIsWritable(path))) {
      state.mode = 'full';
    }
    const shouldExpandPDF = isMobileLayout() && typeof isPDFFile === 'function' && isPDFFile(path);
    state.mobileViewerExpanded = Boolean(options.mobileViewerExpanded ?? (shouldExpandPDF || state.mobileViewerExpanded));
    state.editorReady = false;
    if (!isExternalTab(path)) await ensurePathVisible(path);
    syncLayoutState();
    renderStatus();
    renderFileTabs();
    await renderSelected();
    if (options.restoreState !== false) {
      restoreTabState(path);
    }
    saveWorkspaceState();
    notifyEmbedState();
  } catch (error) {
    if (!isMissingPathError(error)) throw error;

    removeUnavailablePath(path);
    const fallbackPath = state.openTabs[0] || '';
    if (fallbackPath) {
      await selectTab(fallbackPath);
      return;
    }

    syncLayoutState();
    renderFileTabs();
    renderSplitPane();
    $('viewer').innerHTML = '<div class="empty">No file selected</div>';
    if ($('review-summary')) {
      $('review-summary').textContent = 'Select a file to view its change summary and quick actions.';
    }
    saveWorkspaceState();
    notifyEmbedState();
  }
}

async function selectTab(path, options = {}) {
  if (!isTemporaryTab(path)) {
    await selectFile(path, options);
    return;
  }

  saveCurrentTabState();
  if (!state.temporaryTabs.has(path)) return;
  state.selected = path;
  state.mode = 'edit';
  state.mobileViewerExpanded = false;
  state.editorReady = false;
  syncLayoutState();
  renderStatus();
  renderFileTabs();
  await renderSelected();
  restoreTabState(path);
  saveWorkspaceState();
}

function groupForPath(path) {
  return path.includes('/') ? path.split('/').slice(0, -1).join('/') : '';
}

function ancestorPaths(path) {
  const parts = path.split('/').filter(Boolean);
  const ancestors = [];
  for (let i = 1; i < parts.length; i++) {
    ancestors.push(parts.slice(0, i).join('/'));
  }
  return ancestors;
}

async function ensurePathVisible(path) {
  const missingAncestors = [];
  for (const ancestor of ancestorPaths(path)) {
    state.expandedGroups.add(ancestor);
    if (!state.children.has(ancestor)) {
      missingAncestors.push(ancestor);
    }
  }

  if (missingAncestors.length > 0) {
    const trees = await loadTreePaths(missingAncestors);
    for (const ancestor of missingAncestors) {
      state.children.set(ancestor, trees.get(ancestor) || []);
    }
  }
}

function currentModeForPath(path) {
  if (isTemporaryTab(path)) return 'edit';
  if (!tabIsWritable(path) && state.tabStates[path]?.mode === 'edit') return 'full';
  if (path === state.selected) return state.mode;
  return state.tabStates[path]?.mode || 'full';
}

function modeIcon(mode) {
  const icons = {
    diff: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2v10.2l1.8-1.8L8 11.6 4.5 15 1 11.6l1.2-1.2L4 12.2V2h1Zm6.5-.8L15 4.6l-3.5 3.5-1.2-1.2 1.8-1.8H8V3.4h4.1l-1.8-1.8 1.2-1.2ZM8 10.9h4.1l-1.8-1.8 1.2-1.2 3.5 3.5-3.5 3.4-1.2-1.2 1.8-1.8H8v-1.7Z"/></svg>',
    full: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.5h7.2L13.5 5v9.5h-11v-13H3Zm6.5 1.7V5.7h2.4L9.5 3.2ZM4 3v10h8V7H8V3H4Zm1.2 6h5.6v1.3H5.2V9Zm0 2.2h4.1v1.3H5.2v-1.3Z"/></svg>',
    edit: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.8 1.3 14.7 4 5.8 13H3v-2.8l8.8-8.9Zm0 2.2-7.3 7.4v.6h.6l7.4-7.3-.7-.7ZM2 14h12v1.4H2V14Z"/></svg>',
    save: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2h10.1L14 3.9V14H2V2Zm1.4 1.4v9.2h9.2V4.5l-1.1-1.1H11V7H4V3.4h-.6ZM5.3 3.4v2.2h4.3V3.4H5.3Zm.1 6h5.2v1.3H5.4V9.4Z"/></svg>',
  };
  return icons[mode] || icons.full;
}

function modeLabel(mode) {
  return { diff: 'Diff', full: 'Full', edit: 'Edit' }[mode] || 'Full';
}

function isMobileLayout() {
  return window.matchMedia('(max-width: 900px)').matches;
}

async function openTabMenu(anchor, path) {
  if (isTemporaryTab(path)) {
    showActionMenu(anchor, [
      { label: 'Save As...', action: () => saveTemporaryTab(path) },
      { separator: true },
      { label: 'Close Tab', action: () => closeTab(path) },
    ]);
    return;
  }
  const external = isExternalTab(path);
  try {
    await ensureFileInfo(path);
  } catch (error) {
    setMessage(error.message, 'error');
    return;
  }
  const writable = tabIsWritable(path);
  const mode = currentModeForPath(path);
  const isLiveEdit = path === state.selected && state.mode === 'edit';
  const gitAvailable = state.status?.gitAvailable !== false;
  const items = [
    {
      label: 'Diff',
      active: mode === 'diff',
      disabled: external || !gitAvailable,
      action: () => setTabMode(path, 'diff'),
    },
    { label: 'Full', active: mode === 'full', action: () => setTabMode(path, 'full') },
    {
      label: writable ? (isLiveEdit ? 'Save' : 'Edit') : 'Read Only',
      active: mode === 'edit',
      disabled: !writable || isLiveEdit && (!state.editorReady || state.saveInProgress),
      action: () => editOrSaveTab(path),
    },
    { separator: true },
    ...(!external ? [{ label: 'Copy Relative Path', action: () => copyPath(path, false) }] : []),
    { label: 'Copy Absolute Path', action: () => copyPath(path, true) },
    { label: 'Download', action: () => downloadFile(path) },
  ];

  if (!state.embed) {
    items.push(
      { separator: true },
      { label: 'Split Right', action: () => openSplitPane('right', path) },
      { label: 'Split Down', action: () => openSplitPane('down', path) },
    );
    if (isMobileLayout()) {
      items.push({
        label: state.mobileViewerExpanded ? 'Collapse Mobile Viewer' : 'Expand Mobile Viewer',
        action: () => toggleMobileViewer(),
      });
    }
  } else {
    items.push(
      { separator: true },
      { label: 'Close Split', action: () => closeEmbeddedSplit() },
    );
  }

  items.push(
    { separator: true },
    { label: 'Close Tab', action: () => closeTab(path) },
  );

  showActionMenu(anchor, items);
}

async function setTabMode(path, mode) {
  if ((isExternalTab(path) && mode === 'diff') || (mode === 'edit' && !tabIsWritable(path))) return;
  if (state.selected !== path) {
    await selectFile(path, { mode, restoreState: false });
    return;
  }
  await setMode(mode);
}

async function editOrSaveTab(path) {
  if (state.selected === path && state.mode === 'edit') {
    await saveFile();
    return;
  }
  await setTabMode(path, 'edit');
}

function copyPath(path, absolute) {
  const text = absolute ? absolutePathFor(path) : (path || '.');
  writeClipboard(text);
  setMessage(absolute ? 'Copied absolute path' : 'Copied relative path', 'ok');
}

function absolutePathFor(path) {
  if (isExternalTab(path)) return externalTabPath(path);
  const root = state.status?.root || '';
  if (!root) return path;
  if (!path) return root;
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const cleanRoot = root.replace(/[\\/]+$/, '');
  const cleanPath = separator === '\\' ? path.replaceAll('/', '\\') : path;
  return `${cleanRoot}${separator}${cleanPath}`;
}

function toggleMobileViewer() {
  state.mobileViewerExpanded = !state.mobileViewerExpanded;
  syncLayoutState();
  saveWorkspaceState();
}

function closeEmbeddedSplit() {
  if (!state.embed || !window.parent) return;
  window.parent.postMessage({ type: 'mindgit:close-split' }, window.location.origin);
}

function openTreeMenu(anchor, path, kind) {
  const basePath = kind === 'dir' ? path : groupForPath(path);
  const items = [];

  if (!path && !state.embed) {
    items.push(
      { label: 'New Temporary Tab', action: () => createTemporaryTab() },
      { label: 'Open File by Path...', action: () => promptOpenFilePath() },
      { separator: true },
      { label: 'Open Terminal', action: () => openTerminalPanel() },
      { label: 'New Terminal', action: () => openTerminalPanel({ newTab: true }) },
    );
    for (const connection of state.sshConnections || []) {
      items.push({
        label: `SSH: ${connection.name}`,
        disabled: !connection.configured,
        action: () => openTerminalPanel({ newTab: true, sshName: connection.name }),
      });
    }
    items.push({ separator: true });
  }

  items.push(
    { label: 'New File', action: () => promptCreatePath(basePath, 'file') },
    { label: 'New Folder', action: () => promptCreatePath(basePath, 'dir') },
    { label: 'Upload Files', action: () => promptUploadFiles(basePath) },
    { separator: true },
    { label: 'Copy Relative Path', action: () => copyPath(path, false) },
    { label: 'Copy Absolute Path', action: () => copyPath(path, true) },
  );

  if (kind === 'file' && path) {
    items.push(
      { separator: true },
      { label: 'Download', action: () => downloadFile(path) },
    );
  }

  if (path) {
    items.push(
      { separator: true },
      { label: 'Move...', action: () => promptMovePath(path, kind === 'dir') },
      { label: 'Rename', action: () => promptRenamePath(path, kind === 'dir') },
      { label: 'Delete', danger: true, action: () => deletePath(path, kind === 'dir') },
    );
  }

  showActionMenu(anchor, items);
}

async function promptOpenFilePath() {
  const input = await showPromptDialog({
    title: 'Open File by Path',
    message: 'Enter any absolute path, or a path relative to the current project.',
    placeholder: '/path/to/file.txt',
    confirmLabel: 'Open',
    cancelLabel: 'Cancel',
  });
  if (input === null) return;
  const path = input.trim();
  if (!path) {
    setMessage('Path is required', 'error');
    return;
  }

  try {
    setMessage('Opening...');
    const result = await api(`/api/fs?path=${encodeURIComponent(path)}`);
    const tabPath = result.external ? externalTabId(result.path) : result.path;
    state.fileAccess.set(tabPath, result);
    await selectFile(tabPath, { restoreState: false });
    setMessage(result.writable ? 'Opened' : 'Opened read-only', 'ok');
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

function createTemporaryTab() {
  const existingNumbers = [...state.temporaryTabs.values()]
    .map((tab) => Number(tab.number) || 0);
  const number = Math.max(0, ...existingNumbers) + 1;
  const id = `${temporaryTabPrefix}${Date.now()}-${Math.random().toString(36).slice(2)}`;
  state.temporaryTabs.set(id, { name: `Untitled ${number}`, number });
  state.tabDrafts[id] = '';
  state.tabStates[id] = { mode: 'edit' };
  state.openTabs.push(id);
  selectTab(id, { restoreState: false });
}

function promptUploadFiles(directory) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.hidden = true;
  document.body.appendChild(input);
  input.addEventListener('change', () => {
    const files = [...input.files];
    input.remove();
    if (files.length) uploadFilesSequentially(directory, files);
  }, { once: true });
  input.addEventListener('cancel', () => input.remove(), { once: true });
  input.click();
}

async function uploadFilesSequentially(directory, files) {
  const overlay = document.createElement('div');
  overlay.className = 'prompt-dialog-backdrop upload-dialog-backdrop';
  const dialog = document.createElement('div');
  dialog.className = 'prompt-dialog upload-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');

  const title = document.createElement('h3');
  title.className = 'prompt-dialog-title';
  title.textContent = `Upload to ${directory || 'project root'}`;
  const summary = document.createElement('p');
  summary.className = 'prompt-dialog-message upload-summary';
  const overall = document.createElement('progress');
  overall.className = 'upload-overall-progress';
  overall.max = files.reduce((sum, file) => sum + file.size, 0) || files.length;
  overall.value = 0;
  const list = document.createElement('div');
  list.className = 'upload-list';
  const actions = document.createElement('div');
  actions.className = 'prompt-dialog-actions';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.textContent = 'Cancel';
  actions.appendChild(cancelButton);

  dialog.append(title, summary, overall, list, actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const rows = files.map((file) => {
    const row = document.createElement('div');
    row.className = 'upload-row';
    const header = document.createElement('div');
    header.className = 'upload-row-header';
    const name = document.createElement('span');
    name.className = 'upload-file-name';
    name.textContent = file.name;
    const status = document.createElement('span');
    status.className = 'upload-file-status';
    status.textContent = 'Waiting';
    const progress = document.createElement('progress');
    progress.max = file.size || 1;
    progress.value = 0;
    header.append(name, status);
    row.append(header, progress);
    list.appendChild(row);
    return { row, status, progress };
  });

  let currentRequest = null;
  let canceled = false;
  let completedBytes = 0;
  let uploadedCount = 0;
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  const updateSummary = (loaded = 0) => {
    const currentBytes = completedBytes + loaded;
    overall.value = totalBytes ? currentBytes : uploadedCount;
    summary.textContent = `${uploadedCount} of ${files.length} files complete · ${formatFileSize(currentBytes)} / ${formatFileSize(totalBytes)}`;
  };

  cancelButton.addEventListener('click', () => {
    if (cancelButton.dataset.done === 'true') {
      overlay.remove();
      return;
    }
    canceled = true;
    cancelButton.disabled = true;
    cancelButton.textContent = 'Canceling...';
    currentRequest?.abort();
  });

  updateSummary();
  let failure = null;
  for (let index = 0; index < files.length; index++) {
    if (canceled) break;
    const file = files[index];
    const row = rows[index];
    row.row.classList.add('active');
    row.status.textContent = 'Uploading 0%';

    try {
      await uploadSingleFile(directory, file, (request, loaded) => {
        currentRequest = request;
        row.progress.value = loaded;
        const percent = file.size ? Math.min(100, Math.round((loaded / file.size) * 100)) : 100;
        row.status.textContent = `Uploading ${percent}%`;
        updateSummary(loaded);
      });
      currentRequest = null;
      completedBytes += file.size;
      uploadedCount++;
      row.progress.value = file.size || 1;
      row.status.textContent = 'Complete';
      row.row.classList.remove('active');
      row.row.classList.add('complete');
      updateSummary();
    } catch (error) {
      currentRequest = null;
      failure = canceled ? new Error('Upload canceled') : error;
      row.status.textContent = failure.message;
      row.row.classList.remove('active');
      row.row.classList.add('failed');
      break;
    }
  }

  if (uploadedCount > 0) {
    try {
      state.status = await api('/api/status');
      await refreshLoadedGroups();
      renderStatus();
    } catch (error) {
      failure ||= error;
    }
  }

  if (canceled && !failure) failure = new Error('Upload canceled');

  cancelButton.disabled = false;
  cancelButton.dataset.done = 'true';
  cancelButton.textContent = 'Close';
  if (failure) {
    summary.textContent = `${uploadedCount} of ${files.length} files uploaded. ${failure.message}`;
    summary.classList.add('error');
    setMessage(failure.message, 'error');
  } else {
    summary.textContent = `${files.length} files uploaded successfully.`;
    summary.classList.add('ok');
    setMessage(`${files.length} files uploaded`, 'ok');
  }
}

function uploadSingleFile(directory, file, onProgress) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/upload', window.location.origin);
    if (state.currentProjectKey) url.searchParams.set('project', state.currentProjectKey);
    if (directory) url.searchParams.set('dir', directory);
    url.searchParams.set('name', file.name);

    const request = new XMLHttpRequest();
    request.open('POST', `${url.pathname}${url.search}`);
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    request.upload.addEventListener('progress', (event) => onProgress(request, event.loaded));
    request.addEventListener('load', () => {
      let data = {};
      try { data = JSON.parse(request.responseText || '{}'); } catch {}
      if (request.status >= 200 && request.status < 300) {
        resolve(data);
      } else {
        reject(new Error(data.error || `Upload failed (${request.status})`));
      }
    });
    request.addEventListener('error', () => reject(new Error('Network error while uploading')));
    request.addEventListener('abort', () => reject(new Error('Upload canceled')));
    onProgress(request, 0);
    request.send(file);
  });
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / (1024 ** index);
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

async function promptCreatePath(basePath, kind) {
  const label = kind === 'dir' ? 'folder' : 'file';
  const input = await showPromptDialog({
    title: kind === 'dir' ? 'New Folder' : 'New File',
    message: `Enter the ${label} name or a relative path under the current folder.`,
    placeholder: kind === 'dir' ? 'docs/api' : 'docs/notes.md',
    confirmLabel: 'Create',
    cancelLabel: 'Cancel',
  });
  if (input === null) return;
  const path = resolveCreatePath(basePath, input);
  if (!path) {
    setMessage('Path is required', 'error');
    return;
  }
  await createPath(path, kind);
}

function resolveCreatePath(basePath, input) {
  const cleanInput = input.trim().replace(/^\/+|\/+$/g, '');
  if (!cleanInput) return '';
  if (!basePath) return cleanInput;
  if (cleanInput === basePath || cleanInput.startsWith(`${basePath}/`)) return cleanInput;
  return `${basePath}/${cleanInput}`;
}

async function createPath(path, kind) {
  try {
    setMessage(kind === 'dir' ? 'Creating folder...' : 'Creating file...');
    state.status = await api('/api/fs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, kind }),
    });

    for (const ancestor of ancestorPaths(path)) {
      state.expandedGroups.add(ancestor);
    }
    if (kind === 'dir') state.expandedGroups.add(path);
    await refreshLoadedGroups();
    renderStatus();

    if (kind === 'file') {
      await selectFile(path, { mode: 'edit', restoreState: false });
    } else {
      renderFileTabs();
      saveWorkspaceState();
    }
    setMessage(kind === 'dir' ? 'Folder created' : 'File created', 'ok');
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

async function promptRenamePath(path, isDir) {
  const currentName = displayName(path);
  const input = await showPromptDialog({
    title: `Rename ${isDir ? 'Folder' : 'File'}`,
    message: `Enter a new name for "${currentName}".`,
    value: currentName,
    placeholder: currentName,
    confirmLabel: 'Rename',
    cancelLabel: 'Cancel',
  });
  if (input === null) return;
  const name = input.trim();
  if (!name) {
    setMessage('Name is required', 'error');
    return;
  }
  if (name.includes('/') || name.includes('\\')) {
    setMessage('Name must not contain path separators', 'error');
    return;
  }
  if (name === currentName) return;
  await renamePath(path, name);
}

function renamedPath(path, source, destination) {
  if (!isPathInside(path, source)) return path;
  return `${destination}${path.slice(source.length)}`;
}

function remapPathObjectEntries(entries, source, destination) {
  return Object.fromEntries(Object.entries(entries).map(([path, value]) => [
    renamedPath(path, source, destination),
    value,
  ]));
}

function remapPathMapEntries(entries, source, destination) {
  return new Map([...entries].map(([path, value]) => [
    renamedPath(path, source, destination),
    value,
  ]));
}

function remapWorkspacePath(source, destination) {
  state.openTabs = state.openTabs.map((path) => renamedPath(path, source, destination));
  state.tabStates = remapPathObjectEntries(state.tabStates, source, destination);
  state.tabDrafts = remapPathObjectEntries(state.tabDrafts, source, destination);
  state.tabOriginals = remapPathObjectEntries(state.tabOriginals, source, destination);
  state.fileAccess = remapPathMapEntries(state.fileAccess, source, destination);
  state.expandedGroups = new Set([...state.expandedGroups].map((path) => renamedPath(path, source, destination)));
  state.selected = state.selected ? renamedPath(state.selected, source, destination) : null;
  state.splitPane.tabs = state.splitPane.tabs.map((path) => renamedPath(path, source, destination));
  state.splitPane.selectedPath = state.splitPane.selectedPath
    ? renamedPath(state.splitPane.selectedPath, source, destination)
    : '';
  state.children = new Map();
}

async function renamePath(path, name) {
  const parent = groupForPath(path);
  const destination = parent ? `${parent}/${name}` : name;

  try {
    saveCurrentTabState();
    setMessage('Renaming...');
    state.status = await api('/api/fs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, name }),
    });

    remapWorkspacePath(path, destination);

    await refreshLoadedGroups();
    renderStatus();
    renderFileTabs();
    renderSplitPane();
    if (state.selected) {
      await renderSelected();
      restoreTabState(state.selected);
    }
    syncLayoutState();
    saveWorkspaceState();
    notifyEmbedState();
    setMessage('Renamed', 'ok');
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

async function promptMovePath(path, isDir) {
  const currentDirectory = groupForPath(path) || '.';
  const input = await showPromptDialog({
    title: `Move ${isDir ? 'Folder' : 'File'}`,
    message: `Enter a destination folder for "${path}". Use an absolute path inside the current project, or a path relative to the project root.`,
    value: currentDirectory,
    placeholder: 'docs/archive',
    confirmLabel: 'Move',
    cancelLabel: 'Cancel',
  });
  if (input === null) return;
  const destination = input.trim();
  if (!destination) {
    setMessage('Destination path is required', 'error');
    return;
  }
  await movePath(path, destination);
}

async function movePath(path, destinationDirectory) {
  try {
    saveCurrentTabState();
    setMessage('Moving...');
    const result = await api('/api/fs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, destination: destinationDirectory }),
    });
    state.status = result.status;
    remapWorkspacePath(path, result.path);
    for (const ancestor of ancestorPaths(result.path)) {
      state.expandedGroups.add(ancestor);
    }

    await refreshLoadedGroups();
    renderStatus();
    renderFileTabs();
    renderSplitPane();
    if (state.selected) {
      await renderSelected();
      restoreTabState(state.selected);
    }
    syncLayoutState();
    saveWorkspaceState();
    notifyEmbedState();
    setMessage('Moved', 'ok');
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

async function deletePath(path, isDir) {
  const target = isDir ? 'folder' : 'file';
  const confirmed = await showConfirmDialog({
    title: `Delete ${isDir ? 'Folder' : 'File'}`,
    message: `Delete ${target} "${path}"? This cannot be undone.`,
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    danger: true,
  });
  if (!confirmed) return;

  try {
    setMessage('Deleting...');
    state.status = await api('/api/fs', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, confirm: true }),
    });

    state.openTabs = state.openTabs.filter((tab) => !isPathInside(tab, path));
    for (const tabPath of Object.keys(state.tabStates)) {
      if (isPathInside(tabPath, path)) delete state.tabStates[tabPath];
    }
    for (const tabPath of Object.keys(state.tabDrafts)) {
      if (isPathInside(tabPath, path)) delete state.tabDrafts[tabPath];
    }
    state.expandedGroups = new Set([...state.expandedGroups].filter((group) => !isPathInside(group, path)));
    for (const group of [...state.children.keys()]) {
      if (isPathInside(group, path) || group === groupForPath(path)) {
        state.children.delete(group);
      }
    }

    if (state.splitPane.open && isPathInside(state.splitPane.selectedPath, path)) {
      closeSplitPane();
    }

    const deletedSelected = state.selected && isPathInside(state.selected, path);
    await refreshLoadedGroups();
    renderStatus();

    if (deletedSelected) {
      state.selected = null;
      state.mode = 'full';
      state.editorReady = false;
      if (state.openTabs.length) {
        await selectTab(state.openTabs[0]);
      } else {
        $('viewer').innerHTML = '<div class="empty">No file selected</div>';
        if ($('review-summary')) {
          $('review-summary').textContent = 'Select a file to view its change summary and quick actions.';
        }
      }
    }

    renderFileTabs();
    syncLayoutState();
    saveWorkspaceState();
    notifyEmbedState();
    setMessage('Deleted', 'ok');
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

function isPathInside(path, target) {
  return path === target || path.startsWith(`${target}/`);
}

function downloadFile(path) {
  const url = new URL(fileRequestPath('/api/download', path), window.location.origin);
  if (state.currentProjectKey) {
    url.searchParams.set('project', state.currentProjectKey);
  }

  const anchor = document.createElement('a');
  anchor.href = `${url.pathname}${url.search}`;
  anchor.download = displayName(filePathForTab(path));
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setMessage('Download started', 'ok');
}
