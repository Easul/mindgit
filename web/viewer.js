function updateEditButton(label, options = {}) {
  const editButton = $('edit-tab');
  const saveButton = $('save-tab');
  if (editButton) {
    editButton.textContent = 'Edit';
    editButton.disabled = false;
    editButton.classList.toggle('primary', false);
  }
  if (!saveButton) return;
  const isEditMode = state.mode === 'edit';
  saveButton.hidden = !isEditMode;
  saveButton.textContent = isEditMode ? label : 'Save';
  saveButton.disabled = Boolean(options.disabled) || !isEditMode;
  saveButton.classList.toggle('primary', isEditMode);
}

async function renderSelected() {
  if (!state.selected) return;
  $('current-path').textContent = state.selected;
  $('diff-tab').classList.toggle('active', state.mode === 'diff');
  $('full-tab').classList.toggle('active', state.mode === 'full');
  $('edit-tab').classList.toggle('active', state.mode === 'edit');
  const saveButton = $('save-tab');
  if (saveButton) {
    saveButton.hidden = state.mode !== 'edit';
  }

  const file = state.status.files.find((item) => item.path === state.selected);
  $('review-summary').textContent = file
    ? `${file.path}: ${file.status}，新增 ${file.additions} 行，删除 ${file.deletions} 行。`
    : state.selected;

  const isBinary = isLikelyBinary(state.selected);
  const isImage = isImageFile(state.selected);

  if (state.mode === 'edit') {
    if (isBinary) {
      state.editorReady = false;
      $('viewer').innerHTML = `<div class="binary-notice"><div><strong>Cannot Edit Binary File</strong><p>This file type cannot be edited in the browser.</p></div></div>`;
      updateEditButton('Save', { disabled: true, primary: true });
      return;
    }

    state.editorReady = false;
    updateEditButton('Loading...', { disabled: true, primary: true });
    const data = await api(`/api/file?path=${encodeURIComponent(state.selected)}`);
    state.content = data.content;
    const lineNumbers = renderLineNumberSpans(splitEditorLines(data.content).length, 'editor-line-num');

    $('viewer').innerHTML = `<div class="editor-wrapper">
      <div class="editor-current-line-highlight" id="editor-line-highlight" style="display: none;"></div>
      <div class="editor-line-gutter" id="editor-line-gutter">
        <div class="editor-line-numbers" id="editor-line-numbers">${lineNumbers}</div>
      </div>
      <pre class="editor-highlight ${state.wordWrap ? 'wrap-enabled' : 'wrap-disabled'}" id="editor-highlight" aria-hidden="true"></pre>
      <textarea class="editor ${state.wordWrap ? 'wrap-enabled' : 'wrap-disabled'}" id="editor" spellcheck="false"></textarea>
    </div>`;

    const editor = $('editor');
    const gutter = $('editor-line-gutter');
    editor.value = data.content;

    setTimeout(() => {
      const lineNumberWidth = gutter.offsetWidth;
      editor.style.paddingLeft = `${lineNumberWidth + 12}px`;
    }, 0);

    editor.focus();
    setupEditorShortcuts(editor);
    editor.dispatchEvent(new Event('input'));
    state.editorReady = true;
    updateEditButton('Save', { disabled: state.saveInProgress, primary: true });
    return;
  }

  state.editorReady = false;
  updateEditButton('Edit');
  if (state.mode === 'full') {
    if (isImage) {
      renderImageViewer(state.selected);
    } else if (isBinary) {
      $('viewer').innerHTML = `<div class="binary-notice"><div><strong>Binary File</strong><p>This file cannot be displayed as text.</p></div></div>`;
    } else {
      const data = await api(`/api/file?path=${encodeURIComponent(state.selected)}`);
      renderFullContent(data.content, state.selected);
    }
  } else {
    const data = await api(`/api/diff?path=${encodeURIComponent(state.selected)}`);
    $('viewer').innerHTML = `<pre>${renderDiff(data.diff || 'No diff for this file.')}</pre>`;
  }
}

function isImageFile(path) {
  const ext = path.split('.').pop().toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico'].includes(ext);
}

function isLikelyBinary(path) {
  const ext = path.split('.').pop().toLowerCase();
  const binaryExts = [
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'svg',
    'zip', 'tar', 'gz', 'rar', '7z', 'bz2', 'xz',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'exe', 'dll', 'so', 'dylib', 'bin',
    'wasm', 'pyc', 'class', 'jar',
    'mp3', 'mp4', 'avi', 'mov', 'mkv', 'wav', 'flac',
    'ttf', 'otf', 'woff', 'woff2', 'eot',
  ];
  return binaryExts.includes(ext);
}

function renderImageViewer(imagePath) {
  const imageUrl = `/api/file?path=${encodeURIComponent(imagePath)}`;
  $('viewer').innerHTML = `
    <div class="image-viewer" id="image-viewer">
      <div class="image-controls">
        <button id="zoom-in" type="button">Zoom In</button>
        <button id="zoom-out" type="button">Zoom Out</button>
        <button id="zoom-reset" type="button">Reset</button>
      </div>
      <img id="viewer-image" src="${imageUrl}" alt="${escapeHTML(imagePath)}">
    </div>`;

  const viewer = $('image-viewer');
  const img = $('viewer-image');
  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let isDragging = false;
  let startX = 0;
  let startY = 0;

  img.addEventListener('load', () => {
    const containerWidth = viewer.clientWidth;
    const containerHeight = viewer.clientHeight;
    const imgWidth = img.naturalWidth;
    const imgHeight = img.naturalHeight;

    if (state._pendingImageState) {
      scale = state._pendingImageState.scale;
      translateX = state._pendingImageState.translateX;
      translateY = state._pendingImageState.translateY;
      delete state._pendingImageState;
      updateImageTransform();
      return;
    }

    const scaleX = containerWidth / imgWidth;
    const scaleY = containerHeight / imgHeight;
    scale = Math.min(scaleX, scaleY, 1);

    translateX = (containerWidth - imgWidth * scale) / 2;
    translateY = (containerHeight - imgHeight * scale) / 2;
    updateImageTransform();
  });

  function updateImageTransform() {
    img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    img.style.transformOrigin = '0 0';
  }

  $('zoom-in').addEventListener('click', () => {
    const oldScale = scale;
    scale *= 1.2;
    const centerX = viewer.clientWidth / 2;
    const centerY = viewer.clientHeight / 2;
    translateX = centerX - (centerX - translateX) * (scale / oldScale);
    translateY = centerY - (centerY - translateY) * (scale / oldScale);
    updateImageTransform();
  });

  $('zoom-out').addEventListener('click', () => {
    const oldScale = scale;
    scale /= 1.2;
    if (scale < 0.1) scale = 0.1;
    const centerX = viewer.clientWidth / 2;
    const centerY = viewer.clientHeight / 2;
    translateX = centerX - (centerX - translateX) * (scale / oldScale);
    translateY = centerY - (centerY - translateY) * (scale / oldScale);
    updateImageTransform();
  });

  $('zoom-reset').addEventListener('click', () => {
    const containerWidth = viewer.clientWidth;
    const containerHeight = viewer.clientHeight;
    const imgWidth = img.naturalWidth;
    const imgHeight = img.naturalHeight;
    const scaleX = containerWidth / imgWidth;
    const scaleY = containerHeight / imgHeight;
    scale = Math.min(scaleX, scaleY, 1);
    translateX = (containerWidth - imgWidth * scale) / 2;
    translateY = (containerHeight - imgHeight * scale) / 2;
    updateImageTransform();
  });

  viewer.addEventListener('wheel', (e) => {
    e.preventDefault();
    const oldScale = scale;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    scale *= delta;
    if (scale < 0.1) scale = 0.1;
    if (scale > 10) scale = 10;

    const rect = viewer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    translateX = mouseX - (mouseX - translateX) * (scale / oldScale);
    translateY = mouseY - (mouseY - translateY) * (scale / oldScale);
    updateImageTransform();
  });

  const handleMouseDown = (e) => {
    if (e.target === img || e.target === viewer) {
      e.preventDefault();
      isDragging = true;
      startX = e.clientX - translateX;
      startY = e.clientY - translateY;
      viewer.style.cursor = 'grabbing';
    }
  };

  const handleMouseMove = (e) => {
    if (isDragging) {
      e.preventDefault();
      translateX = e.clientX - startX;
      translateY = e.clientY - startY;
      updateImageTransform();
    }
  };

  const handleMouseUp = () => {
    if (isDragging) {
      isDragging = false;
      viewer.style.cursor = 'move';
    }
  };

  viewer.addEventListener('mousedown', handleMouseDown);
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);

  viewer.dataset.cleanup = () => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };
}

async function saveFile() {
  if (!state.selected || state.saveInProgress) return;
  try {
    state.saveInProgress = true;
    setMessage('Saving...');
    updateEditButton('Saving...', { disabled: true, primary: true });
    const editor = $('editor');
    const content = editor ? editor.value : state.content;
    const cursorStart = editor ? editor.selectionStart : 0;
    const cursorEnd = editor ? editor.selectionEnd : 0;

    const status = await api('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.selected, content }),
    });

    state.content = content;
    state.status = status;
    await refreshLoadedGroups();
    renderStatus();

    if (editor) {
      editor.focus();
      editor.setSelectionRange(cursorStart, cursorEnd);
    }

    setMessage('Saved', 'ok');
  } catch (error) {
    console.error('Save error:', error);
    setMessage(error.message, 'error');
  } finally {
    state.saveInProgress = false;
    updateEditButton(state.mode === 'edit' ? 'Save' : 'Edit', {
      disabled: state.mode === 'edit' ? !state.editorReady : false,
      primary: state.mode === 'edit',
    });
  }
}

function renderFullContent(content, filename) {
  const lines = splitEditorLines(content);
  const ext = filename.split('.').pop().toLowerCase();
  const langMap = {
    js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', c: 'c', cpp: 'cpp',
    cs: 'csharp', php: 'php', swift: 'swift', kt: 'kotlin', scala: 'scala',
    html: 'html', css: 'css', scss: 'scss', sass: 'sass', less: 'less',
    xml: 'xml', json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'markdown', sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash',
  };
  const language = langMap[ext] || 'plaintext';

  const highlightedLines = lines.map(line => {
    if (language !== 'plaintext' && typeof hljs !== 'undefined') {
      try {
        return hljs.highlight(line || ' ', { language, ignoreIllegals: true }).value;
      } catch (e) {
        return escapeHTML(line || ' ');
      }
    }
    return escapeHTML(line || ' ');
  });

  const lineNumbersHTML = lines.map((_, i) =>
    `<span class="line-num" data-line="${i + 1}">${i + 1}</span>`
  ).join('');

  const codeContentHTML = highlightedLines.map((line, i) =>
    `<span class="code-line" data-line="${i + 1}">${line}</span>`
  ).join('');

  $('viewer').innerHTML = `<pre><code class="line-numbers">${lineNumbersHTML}</code><code class="code-content">${codeContentHTML}</code></pre>`;

  const preEl = $('viewer').querySelector('pre');
  document.querySelectorAll('.line-num').forEach(lineNum => {
    lineNum.addEventListener('click', () => {
      const lineNumber = parseInt(lineNum.dataset.line);
      document.querySelectorAll('.code-line.highlighted').forEach(el => el.classList.remove('highlighted'));
      const codeLines = document.querySelectorAll('.code-line');
      const targetLine = codeLines[lineNumber - 1];
      if (targetLine) {
        targetLine.classList.add('highlighted');
        if (preEl) {
          const targetTop = targetLine.offsetTop - ((preEl.clientHeight - targetLine.offsetHeight) / 2);
          preEl.scrollTop = Math.max(0, targetTop);
        }
      }
    });
  });
}

async function search() {
  const query = $('search').value.trim();
  if (!query) return;
  try {
    setMessage('Searching...');
    const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
    $('search-results').innerHTML = data.results.length ? data.results.map((result) => `
      <button data-search-path="${escapeAttr(result.path)}">
        <div class="where">${escapeHTML(result.path)}:${result.line}:${result.column}</div>
        <div class="preview">${escapeHTML(result.preview)}</div>
      </button>`).join('') : '<p>No matches</p>';
    for (const button of document.querySelectorAll('[data-search-path]')) {
      button.addEventListener('click', async () => selectFile(button.dataset.searchPath));
    }
    setMessage(`${data.results.length} matches`, 'ok');
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

function renderDiff(diff) {
  return diff.split('\n').map((line) => {
    let cls = 'diff-line';
    if (line.startsWith('+') && !line.startsWith('+++')) cls += ' diff-add';
    if (line.startsWith('-') && !line.startsWith('---')) cls += ' diff-del';
    if (line.startsWith('@@')) cls += ' diff-hunk';
    return `<span class="${cls}">${escapeHTML(line)}</span>`;
  }).join('\n');
}
