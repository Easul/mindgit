async function refreshLoadedGroups() {
  const groups = [...state.expandedGroups].filter(Boolean);
  const refreshed = await Promise.all(groups.map(async (group) => {
    const data = await api(`/api/tree?path=${encodeURIComponent(group)}`);
    return [group, data.files];
  }));
  for (const [group, files] of refreshed) {
    state.children.set(group, files);
  }
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
          ${isTreeChange(dir) ? `<span class="status ${dir.status}"><span class="status-dot"></span></span>` : ''}
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
          ${isChanged(file) ? `<span class="status ${file.status}">${file.status}</span>` : ''}
          <span class="file-path">${escapeHTML(displayName(file.path))}</span>
        </span>
        <span class="mini-stat">${isChanged(file) ? `+${file.additions} -${file.deletions}` : ''}</span>
      </button>
      <button class="tree-action" type="button" data-tree-menu data-tree-kind="file" data-tree-path="${escapeAttr(file.path)}" title="File actions">...</button>
    </div>`;
}

function displayName(path) {
  return path.includes('/') ? path.split('/').pop() : path;
}

function isChanged(file) {
  return Boolean(file.status) && file.status !== 'I' && !file.ignored;
}

function isTreeChange(entry) {
  return Boolean(entry.status) && entry.status !== 'I';
}

async function handleTreeClick(event) {
  if (state.view === 'history') {
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
        const data = await api(`/api/tree?path=${encodeURIComponent(dir)}`);
        state.children.set(dir, data.files);
      }
      state.expandedGroups.add(dir);
    }
    renderStatus();
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
    const fileName = path.includes('/') ? path.split('/').pop() : path;
    const isActive = path === state.selected;
    const mode = currentModeForPath(path);
    const menuIconMode = isActive && mode === 'edit' ? 'save' : mode;
    const menuLabel = menuIconMode === 'save' ? 'Save' : modeLabel(mode);
    return `
      <div class="file-tab ${isActive ? 'active' : ''}" title="${escapeHTML(path)}">
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
      await selectFile(tab.dataset.tabPath);
    });
  });

  tabsContainer.querySelectorAll('[data-tab-menu]').forEach(menuBtn => {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTabMenu(menuBtn, menuBtn.dataset.tabMenu);
    });
  });

  tabsContainer.querySelectorAll('[data-close-tab]').forEach(closeBtn => {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(closeBtn.dataset.closeTab);
    });
  });
}

function closeTab(path) {
  const index = state.openTabs.indexOf(path);
  if (index === -1) return;

  state.openTabs.splice(index, 1);
  delete state.tabStates[path];

  if (path === state.selected) {
    if (state.openTabs.length > 0) {
      const newIndex = index > 0 ? index - 1 : 0;
      selectFile(state.openTabs[newIndex]);
    } else {
      state.selected = null;
      state.mode = 'full';
      state.mobileViewerExpanded = false;
      state.editorReady = false;
      syncLayoutState();
      $('viewer').innerHTML = '<div class="empty">No file selected</div>';
      if ($('review-summary')) {
        $('review-summary').textContent = '选择文件后，这里会显示变更摘要、风险提示和快速操作入口。';
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
    const pre = viewer.querySelector('pre');
    if (pre) {
      scrollTop = pre.scrollTop;
      scrollLeft = pre.scrollLeft;
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
      editor.focus();
    }

    if (viewer && savedState.scrollTop !== undefined) {
      const pre = viewer.querySelector('pre');
      if (pre) {
        pre.scrollTop = savedState.scrollTop;
        pre.scrollLeft = savedState.scrollLeft;
      } else {
        viewer.scrollTop = savedState.scrollTop;
        viewer.scrollLeft = savedState.scrollLeft;
      }
    }
  }, 100);
}

async function selectFile(path, options = {}) {
  saveCurrentTabState();

  if (!state.status) {
    state.status = await api('/api/status');
  }

  if (!state.openTabs.includes(path)) {
    state.openTabs.push(path);
  }

  state.selected = path;
  const savedState = options.restoreState === false ? null : state.tabStates[path];
  state.mode = options.mode || savedState?.mode || 'full';
  state.mobileViewerExpanded = Boolean(options.mobileViewerExpanded ?? state.mobileViewerExpanded);
  state.editorReady = false;
  await ensurePathVisible(path);
  syncLayoutState();
  renderStatus();
  renderFileTabs();
  await renderSelected();
  if (options.restoreState !== false) {
    restoreTabState(path);
  }
  saveWorkspaceState();
  notifyEmbedState();
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
  for (const ancestor of ancestorPaths(path)) {
    state.expandedGroups.add(ancestor);
    if (!state.children.has(ancestor)) {
      const data = await api(`/api/tree?path=${encodeURIComponent(ancestor)}`);
      state.children.set(ancestor, data.files);
    }
  }
}

function currentModeForPath(path) {
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

function openTabMenu(anchor, path) {
  const mode = currentModeForPath(path);
  const isLiveEdit = path === state.selected && state.mode === 'edit';
  const items = [
    { label: 'Diff', active: mode === 'diff', action: () => setTabMode(path, 'diff') },
    { label: 'Full', active: mode === 'full', action: () => setTabMode(path, 'full') },
    {
      label: isLiveEdit ? 'Save' : 'Edit',
      active: mode === 'edit',
      disabled: isLiveEdit && (!state.editorReady || state.saveInProgress),
      action: () => editOrSaveTab(path),
    },
    { separator: true },
    { label: 'Copy Relative Path', action: () => copyPath(path, false) },
    { label: 'Copy Absolute Path', action: () => copyPath(path, true) },
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
  const text = absolute ? absolutePathFor(path) : path;
  writeClipboard(text);
  setMessage(absolute ? 'Copied absolute path' : 'Copied relative path', 'ok');
}

function absolutePathFor(path) {
  const root = state.status?.root || '';
  if (!root) return path;
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
  const items = [
    { label: 'New File', action: () => promptCreatePath(basePath, 'file') },
    { label: 'New Folder', action: () => promptCreatePath(basePath, 'dir') },
  ];

  if (path) {
    items.push(
      { separator: true },
      { label: 'Delete', danger: true, action: () => deletePath(path, kind === 'dir') },
    );
  }

  showActionMenu(anchor, items);
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
        await selectFile(state.openTabs[0]);
      } else {
        $('viewer').innerHTML = '<div class="empty">No file selected</div>';
        if ($('review-summary')) {
          $('review-summary').textContent = '选择文件后，这里会显示变更摘要、风险提示和快速操作入口。';
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
