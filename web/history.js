async function loadHistory() {
  if (!state.status) {
    state.status = await api('/api/status');
  }
  const data = await api('/api/commits?limit=50');
  state.history = data.commits || [];
  if (!state.selectedCommit && state.history.length) {
    await selectCommit(state.history[0].hash, false);
  } else if (state.selectedCommit) {
    const detail = await api(`/api/commit?sha=${encodeURIComponent(state.selectedCommit.hash)}`);
    state.selectedCommit = detail.commit;
    state.commitFiles = detail.files || [];
  }
}

function renderHistory() {
  syncLayoutState();
  $('root').textContent = state.status ? state.status.root : '-';
  $('branch').textContent = state.status ? state.status.branch : '-';
  $('modified').textContent = '0';
  $('added').textContent = '0';
  $('deleted').textContent = '0';
  $('lines').textContent = state.selectedCommit ? state.selectedCommit.shortHash : '+0 -0';
  $('change-title').textContent = `History (${state.history.length})`;
  $('file-list').innerHTML = `
    <div class="commit-list">
      ${state.history.map(renderCommit).join('') || '<div class="empty">No commits</div>'}
    </div>
    ${state.selectedCommit ? renderCommitFiles() : ''}`;
  $('review-summary').textContent = state.selectedCommit
    ? `${state.selectedCommit.shortHash}: ${state.selectedCommit.subject}`
    : '选择提交后，这里会显示提交摘要。';
  if (!state.selectedCommitFile) {
    $('viewer').innerHTML = `<div class="empty">${state.selectedCommit ? 'Select a file from this commit' : 'No commit selected'}</div>`;
  }
}

function renderCommit(commit) {
  return `
    <button class="commit-item ${state.selectedCommit && commit.hash === state.selectedCommit.hash ? 'active' : ''}" type="button" data-commit="${escapeAttr(commit.hash)}">
      <div class="commit-subject">${escapeHTML(commit.subject)}</div>
      <div class="commit-meta">${escapeHTML(commit.shortHash)} · ${escapeHTML(commit.author)} · ${escapeHTML(formatDate(commit.date))}</div>
    </button>`;
}

function renderCommitFiles() {
  return `
    <div class="commit-files-title">Changed files (${state.commitFiles.length})</div>
    <div class="tree">
      ${state.commitFiles.map((file) => renderCommitFile(file)).join('') || '<div class="empty">No files</div>'}
    </div>`;
}

function renderCommitFile(file) {
  return `
    <button class="file ${file.path === state.selectedCommitFile ? 'active' : ''}" title="${escapeHTML(file.path)}" data-commit-path="${escapeAttr(file.path)}" style="--depth: 0">
      <span class="file-main">
        <span class="status ${file.status}">${file.status}</span>
        <span class="file-path">${escapeHTML(file.path)}</span>
      </span>
      <span class="mini-stat">+${file.additions} -${file.deletions}</span>
    </button>`;
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
