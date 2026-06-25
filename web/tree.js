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
      <button class="group-name ${dir.ignored ? 'ignored' : ''}" type="button" data-group="${escapeAttr(dir.path)}" style="--depth: ${depth}">
        <span class="chevron ${expanded ? 'open' : ''}"></span>
        <span>${escapeHTML(displayName(dir.path))}</span>
        ${isTreeChange(dir) ? `<span class="status ${dir.status}"><span class="status-dot"></span></span>` : ''}
      </button>
      ${expanded ? renderEntries(children, depth + 1) : ''}
    </div>`;
}

function renderFile(file, depth) {
  return `
    <button class="file ${file.path === state.selected ? 'active' : ''} ${file.ignored ? 'ignored' : ''}" title="${escapeHTML(file.path)}" data-path="${escapeAttr(file.path)}" style="--depth: ${depth}">
      <span class="file-main">
        ${isChanged(file) ? `<span class="status ${file.status}">${file.status}</span>` : ''}
        <span class="file-path">${escapeHTML(displayName(file.path))}</span>
      </span>
      <span class="mini-stat">${isChanged(file) ? `+${file.additions} -${file.deletions}` : ''}</span>
    </button>`;
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

  if (state.openTabs.length === 0) {
    tabsContainer.innerHTML = '';
    tabsContainer.style.display = 'none';
    return;
  }

  tabsContainer.style.display = 'flex';
  tabsContainer.innerHTML = state.openTabs.map(path => {
    const fileName = path.includes('/') ? path.split('/').pop() : path;
    const isActive = path === state.selected;
    return `
      <button class="file-tab ${isActive ? 'active' : ''}" data-tab-path="${escapeAttr(path)}" title="${escapeHTML(path)}">
        <span>${escapeHTML(fileName)}</span>
        <span class="file-tab-close" data-close-tab="${escapeAttr(path)}">×</span>
      </button>`;
  }).join('');

  document.querySelectorAll('[data-tab-path]').forEach(tab => {
    tab.addEventListener('click', async (e) => {
      if (!e.target.closest('.file-tab-close')) {
        await selectFile(tab.dataset.tabPath);
      }
    });
  });

  document.querySelectorAll('[data-close-tab]').forEach(closeBtn => {
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
      $('current-path').textContent = 'Select a changed file';
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

  if (savedState.mode && savedState.mode !== state.mode) {
    state.mode = savedState.mode;
  }

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
  state.mode = options.mode || 'full';
  state.mobileViewerExpanded = true;
  state.editorReady = false;
  state.expandedGroups.add(groupForPath(path));
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
