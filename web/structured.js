function isDrawioFile(path) {
  const lower = path.toLowerCase();
  return lower.endsWith('.drawio') || lower.endsWith('.dio') || lower.endsWith('.drawio.xml');
}

function isKmFile(path) {
  return path.toLowerCase().endsWith('.km');
}

function isXmindFile(path) {
  return path.toLowerCase().endsWith('.xmind');
}

function isStructuredFile(path) {
  return isDrawioFile(path) || isKmFile(path) || isXmindFile(path);
}

async function renderStructuredFull(path) {
  if (isDrawioFile(path)) {
    const [data] = await Promise.all([
      api(`/api/file?path=${encodeURIComponent(path)}`),
      ensureMxGraphAssets(),
    ]);
    renderDrawioViewer(data.content, path, false);
    return;
  }
  if (isKmFile(path)) {
    const data = await api(`/api/file?path=${encodeURIComponent(path)}`);
    renderKmViewer(data.content, path, false);
    return;
  }
  if (isXmindFile(path)) {
    const data = await api(`/api/xmind?path=${encodeURIComponent(path)}`);
    renderXmindViewer(data.content, path);
  }
}

async function renderStructuredEdit(path, draftContent = null) {
  if (isXmindFile(path)) {
    $('viewer').innerHTML = `<div class="binary-notice"><div><strong>Read Only</strong><p>XMind files can be browsed, but editing is not supported.</p></div></div>`;
    state.editorReady = false;
    updateEditButton('Save', { disabled: true, primary: true });
    return;
  }

  const [loadedContent] = await Promise.all([
    draftContent === null ? api(`/api/file?path=${encodeURIComponent(path)}`) : Promise.resolve(null),
    isDrawioFile(path) ? ensureMxGraphAssets() : Promise.resolve(true),
  ]);
  const content = draftContent ?? loadedContent.content;
  if (draftContent === null) rememberTabOriginal(path, content);
  state.content = content;
  if (isDrawioFile(path)) {
    renderDrawioViewer(content, path, true);
  } else {
    renderKmViewer(content, path, true);
  }
  state.editorReady = true;
  updateEditButton('Save', { disabled: state.saveInProgress, primary: true });
}

function structuredEditorContent() {
  const host = $('viewer')?.querySelector('[data-structured-editor="true"]');
  if (!host || typeof host._mindgitGetContent !== 'function') return null;
  return host._mindgitGetContent();
}

function renderStructuredSourceEditor({ title, message, content, editable }) {
  const host = document.createElement('div');
  host.className = 'structured-editor source-fallback';
  host.dataset.structuredEditor = editable ? 'true' : 'false';
  host.innerHTML = `
    <div class="structured-toolbar">
      <strong>${escapeHTML(title)}</strong>
      <span>${escapeHTML(message)}</span>
    </div>
    <textarea class="structured-source" spellcheck="false" ${editable ? '' : 'readonly'}></textarea>`;
  $('viewer').innerHTML = '';
  $('viewer').appendChild(host);
  const textarea = host.querySelector('textarea');
  textarea.value = content;
  if (editable) host._mindgitGetContent = () => textarea.value;
}
