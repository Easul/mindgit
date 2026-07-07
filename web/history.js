async function loadHistory() {
  state.status = await api('/api/status');
  const data = await api('/api/commits?limit=50');
  state.history = data.commits || [];
  if (!state.history.length) {
    state.selectedCommit = null;
    state.commitFiles = [];
    state.selectedCommitFile = null;
    return;
  }

  const selectedHash = state.selectedCommit?.hash;
  const nextHash = state.history.some((commit) => commit.hash === selectedHash)
    ? selectedHash
    : state.history[0].hash;
  await selectCommit(nextHash, false);
}

function renderHistory() {
  syncLayoutState();
  renderFileTabs();
  $('root').textContent = state.status ? state.status.root : '-';
  $('branch').textContent = state.status ? state.status.branch : '-';
  $('modified').textContent = '0';
  $('added').textContent = '0';
  $('deleted').textContent = '0';
  $('lines').textContent = state.selectedCommit?.shortHash || '+0 -0';
  $('change-title').textContent = `History (${state.history.length})`;
  $('file-list').innerHTML = `
    <div class="commit-list">
      ${state.history.map(renderCommit).join('') || '<div class="empty">No commits</div>'}
    </div>
    ${state.selectedCommit ? renderCommitFiles() : ''}`;
  $('review-summary').textContent = state.selectedCommit?.subject
    ? `${state.selectedCommit.shortHash}: ${state.selectedCommit.subject}`
    : '选择提交后，这里会显示提交摘要。';
  if (!state.selectedCommitFile) {
    $('viewer').innerHTML = '<div class="empty">No file selected</div>';
  }
  saveWorkspaceState();
}

function renderCommit(commit) {
  if (commit.temporary) {
    return `
      <button class="commit-item ${state.selectedCommit && commit.hash === state.selectedCommit.hash ? 'active' : ''}" type="button" data-commit="${escapeAttr(commit.hash)}">
        <div class="commit-subject">${escapeHTML(commit.subject)}</div>
        <div class="commit-meta">INDEX · staged changes</div>
      </button>`;
  }

  return `
    <button class="commit-item ${state.selectedCommit && commit.hash === state.selectedCommit.hash ? 'active' : ''}" type="button" data-commit="${escapeAttr(commit.hash)}">
      <div class="commit-subject">${escapeHTML(commit.subject)}</div>
      <div class="commit-meta">${escapeHTML(commit.shortHash)} · ${escapeHTML(commit.author)} · ${escapeHTML(formatDate(commit.date))}</div>
    </button>`;
}

function renderCommitFiles() {
  const title = state.selectedCommit?.temporary
    ? `Temporary staged files (${state.commitFiles.length})`
    : `Changed files (${state.commitFiles.length})`;
  return `
    <div class="commit-files-title">${title}</div>
    <div class="tree">
      ${state.commitFiles.map((file) => renderCommitFile(file)).join('') || '<div class="empty">No files</div>'}
    </div>`;
}

function renderCommitFile(file) {
  const restoreButton = state.selectedCommit?.temporary
    ? `<button class="tree-action history-restore-action" type="button" data-restore-staged-path="${escapeAttr(file.path)}" title="Restore staged file">Restore</button>`
    : '';
  return `
    <div class="tree-row history-file-row">
      <button class="file ${file.path === state.selectedCommitFile ? 'active' : ''}" title="${escapeHTML(file.path)}" data-commit-path="${escapeAttr(file.path)}" style="--depth: 0">
        <span class="file-main">
          <span class="${fileStatusClasses(file)}">${fileStatusLabel(file)}</span>
          <span class="file-path">${escapeHTML(file.path)}</span>
        </span>
        <span class="mini-stat">+${file.additions} -${file.deletions}</span>
      </button>
      ${restoreButton}
    </div>`;
}

async function selectCommit(sha, shouldRender = true) {
  const detail = await api(`/api/commit?sha=${encodeURIComponent(sha)}`);
  state.selectedCommit = detail.commit;
  state.commitFiles = detail.files || [];
  state.selectedCommitFile = null;
  if (shouldRender) {
    renderHistory();
  }
}

async function selectCommitFile(path) {
  if (!state.selectedCommit) return;
  state.selectedCommitFile = path;
  syncLayoutState();
  const data = await api(`/api/commit-diff?sha=${encodeURIComponent(state.selectedCommit.hash)}&path=${encodeURIComponent(path)}`);
  $('viewer').innerHTML = `<pre>${renderDiff(data.diff || 'No diff for this file.')}</pre>`;
  renderHistory();
}

async function restoreStagedFile(path) {
  try {
    setMessage('Restoring staged file...');
    state.status = await api('/api/stage', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    await refreshLoadedGroups();
    await loadHistory();
    renderHistory();
    setMessage('Staged file restored', 'ok');
  } catch (error) {
    setMessage(error.message, 'error');
  }
}
