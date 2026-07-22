let pdfJSImportPromise = null;
let fullViewerFindBar = null;

function updateEditButton(label, options = {}) {
  renderFileTabs();
}

function getViewerScrollTarget(root = $('viewer')) {
  if (!root) return null;
  return root.querySelector('#markdown-viewer-scroll')
    || root.querySelector('#code-viewer-scroll')
    || root.querySelector('#pdf-page-scroll')
    || root.querySelector('#viewer > pre')
    || root.querySelector('.image-viewer')
    || null;
}

function attachScrollableInteractionTarget(scrollTarget) {
  if (!scrollTarget || scrollTarget._mindgitScrollTargetBound) return;
  scrollTarget._mindgitScrollTargetBound = true;

  scrollTarget.addEventListener('pointerdown', () => {
    if (typeof focusWithoutScroll === 'function') {
      focusWithoutScroll(scrollTarget);
    } else {
      scrollTarget.focus?.();
    }
  });

  scrollTarget.addEventListener('wheel', (event) => {
    if (event.ctrlKey) return;

    const nextTop = scrollTarget.scrollTop + event.deltaY;
    const horizontalDelta = event.deltaX + (event.shiftKey ? event.deltaY : 0);
    const nextLeft = scrollTarget.scrollLeft + horizontalDelta;
    const canScrollVertically = scrollTarget.scrollHeight > scrollTarget.clientHeight;
    const canScrollHorizontally = scrollTarget.scrollWidth > scrollTarget.clientWidth;

    if (!canScrollVertically && !canScrollHorizontally) return;

    event.preventDefault();
    if (canScrollVertically) {
      scrollTarget.scrollTop = nextTop;
    }
    if (canScrollHorizontally) {
      scrollTarget.scrollLeft = nextLeft;
    }

    if (typeof focusWithoutScroll === 'function') {
      focusWithoutScroll(scrollTarget);
    } else {
      scrollTarget.focus?.();
    }
  }, { passive: false });
}

async function renderSelected() {
  if (!state.selected) return;
  cleanupViewerArtifacts();
  const draftContent = typeof state.tabDrafts[state.selected] === 'string'
    ? state.tabDrafts[state.selected]
    : null;

  if (isTemporaryTab(state.selected)) {
    if ($('review-summary')) {
      $('review-summary').textContent = 'Temporary text tab. Press Ctrl+S to choose a path and save it as a file.';
    }
    renderTextEditor(draftContent || '');
    return;
  }

  const file = state.status.files.find((item) => item.path === state.selected);
  if ($('review-summary')) {
    $('review-summary').textContent = file
      ? `${file.path}: ${describeFileStatus(file)}, +${file.additions} / -${file.deletions} lines.`
      : state.selected;
  }

  const isBinary = isLikelyBinary(state.selected);
  const isImage = isImageFile(state.selected);
  const isPDF = isPDFFile(state.selected);
  const isStructured = isStructuredFile(state.selected);

  if (state.mode === 'edit') {
    if (isStructured) {
      state.editorReady = false;
      updateEditButton('Loading...', { disabled: true, primary: true });
      await renderStructuredEdit(state.selected, draftContent);
      return;
    }

    if (isBinary) {
      state.editorReady = false;
      $('viewer').innerHTML = `<div class="binary-notice"><div><strong>Cannot Edit Binary File</strong><p>This file type cannot be edited in the browser.</p></div></div>`;
      updateEditButton('Save', { disabled: true, primary: true });
      return;
    }

    const content = draftContent ?? (await api(`/api/file?path=${encodeURIComponent(state.selected)}`)).content;
    if (draftContent === null) rememberTabOriginal(state.selected, content);
    renderTextEditor(content);
    return;
  }

  state.editorReady = false;
  updateEditButton('Edit');
  if (state.mode === 'full') {
    if (isStructured) {
      await renderStructuredFull(state.selected);
    } else if (isImage) {
      renderImageViewer(state.selected);
    } else if (isPDF) {
      try {
        await renderPDFViewer(state.selected);
      } catch (error) {
        $('viewer').innerHTML = `<div class="binary-notice"><div><strong>Cannot Preview PDF</strong><p>${escapeHTML(error.message)}</p><button id="pdf-error-download" type="button">Download</button></div></div>`;
        $('pdf-error-download').addEventListener('click', () => downloadFile(state.selected));
      }
    } else if (isBinary) {
      $('viewer').innerHTML = `<div class="binary-notice"><div><strong>Binary File</strong><p>This file cannot be displayed as text.</p></div></div>`;
    } else {
      const data = await api(`/api/file?path=${encodeURIComponent(state.selected)}`);
      rememberTabOriginal(state.selected, data.content);
      state.content = data.content;
      renderFullContent(data.content, state.selected);
    }
  } else {
    const data = await api(`/api/diff?path=${encodeURIComponent(state.selected)}`);
    $('viewer').innerHTML = `<pre tabindex="-1">${renderDiff(data.diff || 'No diff for this file.')}</pre>`;
    attachScrollableInteractionTarget(getViewerScrollTarget());
  }
  syncViewerHeight();
}

function renderTextEditor(content) {
  state.editorReady = false;
  updateEditButton('Loading...', { disabled: true, primary: true });
  state.content = content;
  const lineNumbers = renderLineNumberSpans(splitEditorLines(content).length, 'editor-line-num');

  $('viewer').innerHTML = `<div class="editor-wrapper">
    <div class="editor-line-gutter" id="editor-line-gutter">
      <div class="editor-line-numbers" id="editor-line-numbers">${lineNumbers}</div>
    </div>
    <div class="editor-scroll-area">
      <div class="editor-current-line-highlight" id="editor-line-highlight" style="display: none;"></div>
      <pre class="editor-highlight ${state.wordWrap ? 'wrap-enabled' : 'wrap-disabled'}" id="editor-highlight" aria-hidden="true"></pre>
      <textarea class="editor ${state.wordWrap ? 'wrap-enabled' : 'wrap-disabled'}" id="editor" spellcheck="false"></textarea>
    </div>
  </div>`;

  const editor = $('editor');
  editor.value = content;
  editor.focus();
  setupEditorShortcuts(editor);
  editor.dispatchEvent(new Event('input'));
  state.editorReady = true;
  updateEditButton('Save', { disabled: state.saveInProgress, primary: true });
  syncViewerHeight();
}

function isImageFile(path) {
  const ext = path.split('.').pop().toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico'].includes(ext);
}

function isPDFFile(path) {
  return path.toLowerCase().endsWith('.pdf');
}

function isLikelyBinary(path) {
  const ext = path.split('.').pop().toLowerCase();
  const binaryExts = [
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'svg',
    'zip', 'tar', 'gz', 'rar', '7z', 'bz2', 'xz', 'xmind',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'exe', 'dll', 'so', 'dylib', 'bin',
    'wasm', 'pyc', 'class', 'jar',
    'mp3', 'mp4', 'avi', 'mov', 'mkv', 'wav', 'flac',
    'ttf', 'otf', 'woff', 'woff2', 'eot',
  ];
  return binaryExts.includes(ext);
}

function fileAPIURL(pathname, path) {
  const url = new URL(pathname, window.location.origin);
  if (state.currentProjectKey) url.searchParams.set('project', state.currentProjectKey);
  url.searchParams.set('path', path);
  return `${url.pathname}${url.search}`;
}

async function loadPDFJS() {
  if (!pdfJSImportPromise) {
    pdfJSImportPromise = import('/vendor/pdfjs/pdf.min.mjs').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
      return pdfjs;
    });
  }
  return pdfJSImportPromise;
}

async function renderPDFViewer(pdfPath) {
  const url = fileAPIURL('/api/pdf', pdfPath);
  $('viewer').innerHTML = '<div class="empty">Loading PDF...</div>';

  const probe = await fetch(url, {
    cache: 'no-store',
    headers: { Range: 'bytes=0-0' },
  });
  if (!probe.ok) {
    let message = `Unable to preview PDF (${probe.status})`;
    try {
      const data = await probe.json();
      if (data.error) message = data.error;
    } catch {}
    throw new Error(message);
  }

  const pdfjs = await loadPDFJS();
  const loadingTask = pdfjs.getDocument({
    url,
    rangeChunkSize: 256 * 1024,
    wasmUrl: '/vendor/pdfjs/wasm/',
  });
  const pdfDocument = await loadingTask.promise;
  const savedState = state.tabStates[pdfPath] || {};
  let scale = Math.min(4, Math.max(0.25, savedState.pdfScale || 1));
  let fitWidth = savedState.pdfFitWidth !== false;
  let renderGeneration = 0;
  let scrollSaveTimer = 0;
  let resizeTimer = 0;
  let lastLayoutWidth = 0;
  let renderQueue = [];
  let activeRenders = 0;
  let pageItems = [];
  let resizeObserver = null;
  const renderTasks = new Set();
  let destroyed = false;

  $('viewer').innerHTML = `
    <div class="pdf-viewer" id="pdf-viewer" data-pdf-scale="${scale}" data-pdf-fit-width="${fitWidth}">
      <div class="pdf-controls">
        <label class="pdf-page-jump">
          <input id="pdf-page-number" type="number" min="1" max="${pdfDocument.numPages}" value="1" inputmode="numeric" aria-label="PDF page number">
          <span>/ ${pdfDocument.numPages}</span>
        </label>
        <button id="pdf-jump" type="button">Jump</button>
        <span class="pdf-control-spacer"></span>
        <button id="pdf-zoom-out" type="button" title="Zoom out">−</button>
        <button id="pdf-fit" type="button" title="Fit width">Fit</button>
        <button id="pdf-zoom-in" type="button" title="Zoom in">+</button>
        <button id="pdf-fullscreen" class="pdf-mobile-fullscreen" type="button">Fullscreen</button>
        <button id="pdf-download" type="button">Download</button>
      </div>
      <div class="pdf-page-scroll" id="pdf-page-scroll" tabindex="-1">
        <div class="pdf-page-status" id="pdf-page-status">Loading ${pdfDocument.numPages} pages...</div>
        <div class="pdf-pages" id="pdf-pages"></div>
      </div>
      <button id="pdf-fullscreen-exit" class="pdf-fullscreen-exit" type="button">Exit Fullscreen</button>
    </div>`;

  const viewer = $('pdf-viewer');
  const scroll = $('pdf-page-scroll');
  const pages = $('pdf-pages');
  const status = $('pdf-page-status');
  const pageNumberInput = $('pdf-page-number');
  const fullscreenButton = $('pdf-fullscreen');
  const fullscreenExitButton = $('pdf-fullscreen-exit');

  const persistState = () => {
    viewer.dataset.pdfScale = String(scale);
    viewer.dataset.pdfFitWidth = String(fitWidth);
  };

  const updateRenderStatus = () => {
    if (activeRenders || renderQueue.length) {
      status.textContent = `Rendering pages near your position...`;
      status.hidden = false;
    } else {
      status.hidden = true;
    }
  };

  const renderPageItem = async (item, generation) => {
    if (destroyed || generation !== renderGeneration || item.rendered) return;
    const page = await pdfDocument.getPage(item.pageNumber);
    if (destroyed || generation !== renderGeneration) {
      page.cleanup();
      return;
    }

    const canvas = document.createElement('canvas');
    const outputScale = Math.min(isMobileLayout() ? 1.25 : 1.5, window.devicePixelRatio || 1);
    const context = canvas.getContext('2d', { alpha: false });
    canvas.width = Math.floor(item.viewport.width * outputScale);
    canvas.height = Math.floor(item.viewport.height * outputScale);
    canvas.style.width = `${Math.floor(item.viewport.width)}px`;
    canvas.style.height = `${Math.floor(item.viewport.height)}px`;
    canvas.setAttribute('aria-label', `Page ${item.pageNumber} of ${pdfDocument.numPages}`);
    item.element.replaceChildren(canvas);

    const renderTask = page.render({
      canvasContext: context,
      viewport: item.viewport,
      transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
    });
    renderTasks.add(renderTask);
    try {
      await renderTask.promise;
      if (!destroyed && generation === renderGeneration) item.rendered = true;
    } catch (error) {
      if (error?.name !== 'RenderingCancelledException') throw error;
    } finally {
      renderTasks.delete(renderTask);
      page.cleanup();
    }
  };

  const pumpRenderQueue = () => {
    if (destroyed) return;
    const generation = renderGeneration;
    while (activeRenders < 2 && renderQueue.length) {
      const item = renderQueue.shift();
      item.queued = false;
      if (item.rendered) continue;
      activeRenders += 1;
      renderPageItem(item, generation).catch((error) => {
        setMessage(error.message || 'Unable to render PDF page', 'error');
      }).finally(() => {
        if (generation !== renderGeneration) return;
        activeRenders -= 1;
        updateRenderStatus();
        pumpRenderQueue();
      });
    }
    updateRenderStatus();
  };

  const queueNearbyPages = () => {
    if (!pageItems.length || destroyed) return;
    const viewportHeight = Math.max(1, scroll.clientHeight);
    const center = scroll.scrollTop + viewportHeight / 2;
    const rangeTop = Math.max(0, scroll.scrollTop - viewportHeight * 2);
    const rangeBottom = scroll.scrollTop + viewportHeight * 3;
    const nearbyItems = pageItems.filter((item) => (
      item.element.offsetTop + item.element.offsetHeight >= rangeTop
      && item.element.offsetTop <= rangeBottom
    ));
    const nearbySet = new Set(nearbyItems);
    for (const item of renderQueue) {
      if (!nearbySet.has(item)) item.queued = false;
    }
    renderQueue = renderQueue.filter((item) => nearbySet.has(item) && !item.rendered);
    for (const item of nearbyItems) {
      if (item.rendered || item.queued) continue;
      item.queued = true;
      renderQueue.push(item);
    }
    renderQueue.sort((left, right) => (
      Math.abs(left.element.offsetTop + left.element.offsetHeight / 2 - center)
      - Math.abs(right.element.offsetTop + right.element.offsetHeight / 2 - center)
    ));
    pumpRenderQueue();
  };

  const currentScrollAnchor = () => {
    if (!pageItems.length) return null;
    const targetTop = scroll.scrollTop + 1;
    let low = 0;
    let high = pageItems.length - 1;
    let index = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (pageItems[middle].element.offsetTop <= targetTop) {
        index = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    const item = pageItems[index];
    return {
      pageNumber: item.pageNumber,
      offsetRatio: Math.max(0, Math.min(1, (scroll.scrollTop - item.element.offsetTop) / Math.max(1, item.element.offsetHeight))),
    };
  };

  const updateCurrentPageNumber = () => {
    const anchor = currentScrollAnchor();
    if (anchor && document.activeElement !== pageNumberInput) {
      pageNumberInput.value = String(anchor.pageNumber);
    }
  };

  const buildPagePlaceholders = async ({ scrollTop = 0, scrollRatio = null, anchor = null } = {}) => {
    const generation = ++renderGeneration;
    for (const task of renderTasks) task.cancel();
    renderTasks.clear();
    renderQueue = [];
    activeRenders = 0;
    pageItems = [];
    pages.replaceChildren();
    status.hidden = false;
    $('pdf-fit').classList.toggle('active', fitWidth);
    persistState();

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      if (destroyed || generation !== renderGeneration) return;
      status.textContent = `Preparing page ${pageNumber} of ${pdfDocument.numPages}...`;
      const page = await pdfDocument.getPage(pageNumber);
      if (destroyed || generation !== renderGeneration) {
        page.cleanup();
        return;
      }

      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(240, scroll.clientWidth - (isMobileLayout() ? 16 : 32));
      const renderScale = fitWidth ? Math.min(3, availableWidth / baseViewport.width) : scale;
      const viewport = page.getViewport({ scale: renderScale });
      const pageElement = document.createElement('div');
      pageElement.className = 'pdf-page';
      pageElement.dataset.pageNumber = String(pageNumber);
      pageElement.style.width = `${Math.floor(viewport.width)}px`;
      pageElement.style.height = `${Math.floor(viewport.height)}px`;
      pages.appendChild(pageElement);
      pageItems.push({
        element: pageElement,
        pageNumber,
        queued: false,
        rendered: false,
        viewport,
      });
      page.cleanup();
    }

    if (destroyed || generation !== renderGeneration) return;
    const maxScrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    let targetScrollTop = Number(scrollTop) || 0;
    if (anchor?.pageNumber) {
      const anchorItem = pageItems[Math.min(pageItems.length - 1, Math.max(0, anchor.pageNumber - 1))];
      targetScrollTop = anchorItem.element.offsetTop
        + Math.max(0, Math.min(1, anchor.offsetRatio || 0)) * anchorItem.element.offsetHeight;
    } else if (scrollRatio !== null) {
      targetScrollTop = Math.max(0, Math.min(1, scrollRatio)) * maxScrollTop;
    }
    scroll.scrollTop = Math.min(Math.max(0, targetScrollTop), maxScrollTop);
    lastLayoutWidth = scroll.clientWidth;
    updateCurrentPageNumber();
    status.hidden = true;
    queueNearbyPages();
  };

  const jumpToPage = () => {
    const pageNumber = Math.min(pdfDocument.numPages, Math.max(1, Number(pageNumberInput.value) || 1));
    const item = pageItems[pageNumber - 1];
    if (!item) return;
    pageNumberInput.value = String(pageNumber);
    scroll.scrollTop = item.element.offsetTop;
    queueNearbyPages();
    saveCurrentTabState();
    saveWorkspaceState();
  };

  const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  const syncFullscreenButton = () => {
    const active = fullscreenElement() === viewer || viewer.classList.contains('pdf-fallback-fullscreen');
    fullscreenButton.textContent = active ? 'Exit Fullscreen' : 'Fullscreen';
    fullscreenButton.classList.toggle('active', active);
  };

  const exitPDFFullscreen = async () => {
    if (viewer.classList.contains('pdf-fallback-fullscreen')) {
      viewer.classList.remove('pdf-fallback-fullscreen');
      delete document.documentElement.dataset.pdfFullscreen;
      syncFullscreenButton();
      return;
    }
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (fullscreenElement() && exit) await exit.call(document);
  };

  const togglePDFFullscreen = async () => {
    if (fullscreenElement() === viewer || viewer.classList.contains('pdf-fallback-fullscreen')) {
      await exitPDFFullscreen();
      return;
    }
    const request = viewer.requestFullscreen || viewer.webkitRequestFullscreen;
    if (request) {
      try {
        await request.call(viewer);
        return;
      } catch {}
    }
    viewer.classList.add('pdf-fallback-fullscreen');
    document.documentElement.dataset.pdfFullscreen = 'true';
    syncFullscreenButton();
  };

  $('pdf-zoom-out').addEventListener('click', async () => {
    const anchor = currentScrollAnchor();
    fitWidth = false;
    scale = Math.max(0.25, scale / 1.2);
    await buildPagePlaceholders({ anchor });
  });
  $('pdf-zoom-in').addEventListener('click', async () => {
    const anchor = currentScrollAnchor();
    fitWidth = false;
    scale = Math.min(4, scale * 1.2);
    await buildPagePlaceholders({ anchor });
  });
  $('pdf-fit').addEventListener('click', async () => {
    const anchor = currentScrollAnchor();
    fitWidth = true;
    await buildPagePlaceholders({ anchor });
  });
  $('pdf-jump').addEventListener('click', jumpToPage);
  pageNumberInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    jumpToPage();
  });
  fullscreenButton.addEventListener('click', () => togglePDFFullscreen());
  fullscreenExitButton.addEventListener('click', () => exitPDFFullscreen());
  $('pdf-download').addEventListener('click', () => downloadFile(pdfPath));
  scroll.addEventListener('scroll', () => {
    updateCurrentPageNumber();
    queueNearbyPages();
    window.clearTimeout(scrollSaveTimer);
    scrollSaveTimer = window.setTimeout(() => {
      saveCurrentTabState();
      saveWorkspaceState();
    }, 250);
  }, { passive: true });
  const handleFullscreenChange = () => {
    if (fullscreenElement() !== viewer && viewer.classList.contains('pdf-fallback-fullscreen')) return;
    syncFullscreenButton();
  };
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  if (typeof ResizeObserver === 'function') {
    lastLayoutWidth = scroll.clientWidth;
    resizeObserver = new ResizeObserver(() => {
      if (!fitWidth || destroyed || Math.abs(scroll.clientWidth - lastLayoutWidth) < 2) return;
      const anchor = currentScrollAnchor();
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => buildPagePlaceholders({ anchor }), 120);
    });
    resizeObserver.observe(scroll);
  }
  attachScrollableInteractionTarget(scroll);

  viewer.dataset.mindgitCleanup = 'true';
  viewer._mindgitCleanup = () => {
    destroyed = true;
    renderGeneration += 1;
    window.clearTimeout(scrollSaveTimer);
    window.clearTimeout(resizeTimer);
    resizeObserver?.disconnect();
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    if (fullscreenElement() === viewer || viewer.classList.contains('pdf-fallback-fullscreen')) {
      exitPDFFullscreen().catch(() => {});
    }
    for (const task of renderTasks) task.cancel();
    renderTasks.clear();
    loadingTask.destroy();
  };

  await buildPagePlaceholders({ scrollTop: savedState.scrollTop });
}

function renderImageViewer(imagePath) {
  const imageUrl = `/api/file?path=${encodeURIComponent(imagePath)}`;
  $('viewer').innerHTML = `
    <div class="image-viewer" id="image-viewer" tabindex="-1">
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

  viewer._mindgitCleanup = () => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };
}

function cleanupViewerArtifacts() {
  const viewer = $('viewer');
  if (!viewer) return;
  if (typeof viewer._mindgitCleanup === 'function') {
    try {
      viewer._mindgitCleanup();
    } catch {}
    viewer._mindgitCleanup = null;
  }
  const nestedCleanupTarget = viewer.querySelector('[data-mindgit-cleanup="true"]');
  if (nestedCleanupTarget && typeof nestedCleanupTarget._mindgitCleanup === 'function') {
    try {
      nestedCleanupTarget._mindgitCleanup();
    } catch {}
    nestedCleanupTarget._mindgitCleanup = null;
  }
}

async function saveFile() {
  if (!state.selected || state.saveInProgress) return false;
  if (isTemporaryTab(state.selected)) {
    return saveTemporaryTab(state.selected);
  }
  try {
    state.saveInProgress = true;
    setMessage('Saving...');
    updateEditButton('Saving...', { disabled: true, primary: true });
    const editor = $('editor');
    const structuredContent = structuredEditorContent();
    const content = structuredContent !== null ? structuredContent : editor ? editor.value : state.content;
    const cursorStart = editor ? editor.selectionStart : 0;
    const cursorEnd = editor ? editor.selectionEnd : 0;

    const status = await api('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.selected, content }),
    });

    state.content = content;
    state.tabDrafts[state.selected] = content;
    state.tabOriginals[state.selected] = content;
    state.status = status;
    await refreshLoadedGroups();
    renderStatus();

    if (editor) {
      editor.focus();
      editor.setSelectionRange(cursorStart, cursorEnd);
    }

    setMessage('Saved', 'ok');
    return true;
  } catch (error) {
    console.error('Save error:', error);
    setMessage(error.message, 'error');
    return false;
  } finally {
    state.saveInProgress = false;
    updateEditButton(state.mode === 'edit' ? 'Save' : 'Edit', {
      disabled: state.mode === 'edit' ? !state.editorReady : false,
      primary: state.mode === 'edit',
    });
  }
}

async function saveTemporaryTab(path) {
  if (!isTemporaryTab(path) || state.saveInProgress) return false;
  if (state.selected !== path) await selectTab(path);

  const temporary = state.temporaryTabs.get(path);
  if (!temporary) return false;
  const input = await showPromptDialog({
    title: 'Save Temporary Tab',
    message: 'Enter a path relative to the project root.',
    value: '',
    placeholder: 'notes/scratch.txt',
    confirmLabel: 'Save',
    cancelLabel: 'Cancel',
  });
  if (input === null) return false;
  const savePath = resolveCreatePath('', input);
  if (!savePath) {
    setMessage('Path is required', 'error');
    return false;
  }

  const editor = $('editor');
  const content = editor ? editor.value : state.tabDrafts[path] || '';
  const cursorStart = editor ? editor.selectionStart : 0;
  const cursorEnd = editor ? editor.selectionEnd : 0;

  try {
    state.saveInProgress = true;
    setMessage('Saving...');
    updateEditButton('Saving...', { disabled: true, primary: true });
    const status = await api('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: savePath, content, create: true }),
    });

    const index = state.openTabs.indexOf(path);
    if (index !== -1) state.openTabs[index] = savePath;
    state.selected = savePath;
    state.tabStates[savePath] = state.tabStates[path] || { mode: 'edit' };
    state.tabStates[savePath].mode = 'edit';
    state.tabDrafts[savePath] = content;
    state.tabOriginals[savePath] = content;
    delete state.tabStates[path];
    delete state.tabDrafts[path];
    delete state.tabOriginals[path];
    state.temporaryTabs.delete(path);
    state.content = content;
    state.status = status;
    for (const ancestor of ancestorPaths(savePath)) state.expandedGroups.add(ancestor);
    await refreshLoadedGroups();
    renderStatus();
    renderFileTabs();
    syncLayoutState();
    saveWorkspaceState();
    notifyEmbedState();
    if (editor) {
      editor.focus();
      editor.setSelectionRange(cursorStart, cursorEnd);
    }
    setMessage('Saved', 'ok');
    return true;
  } catch (error) {
    setMessage(error.message, 'error');
    return false;
  } finally {
    state.saveInProgress = false;
    updateEditButton('Save', { disabled: !state.editorReady, primary: true });
  }
}

function renderFullContent(content, filename) {
  destroyFullViewerFindBar();
  if (isMarkdownFile(filename)) {
    renderMarkdownContent(content, filename);
    return;
  }

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
    if (findURLsInText(line).length) {
      return linkifyPlainTextHTML(line || ' ');
    }
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
    `<span class="line-num code-viewer-line-num" data-line="${i + 1}">${i + 1}</span>`
  ).join('');

  const codeContentHTML = highlightedLines.map((line, i) =>
    `<span class="code-line" data-line="${i + 1}">${line}</span>`
  ).join('');

  $('viewer').innerHTML = `<div class="code-viewer">
    <div class="code-viewer-gutter" id="code-viewer-gutter">
      <div class="code-viewer-line-numbers" id="code-viewer-line-numbers">${lineNumbersHTML}</div>
    </div>
    <div class="code-viewer-scroll" id="code-viewer-scroll" tabindex="-1">
      <pre class="code-viewer-pre"><code class="code-content">${codeContentHTML}</code></pre>
    </div>
  </div>`;

  const scrollArea = $('code-viewer-scroll');
  const lineNumbers = $('code-viewer-line-numbers');
  attachScrollableInteractionTarget(scrollArea);
  const syncCodeViewerGutter = () => {
    if (lineNumbers && scrollArea) {
      lineNumbers.style.transform = `translateY(${-scrollArea.scrollTop}px)`;
    }
  };
  scrollArea?.addEventListener('scroll', syncCodeViewerGutter);
  syncCodeViewerGutter();

  $('viewer').querySelectorAll('.code-viewer-line-num').forEach(lineNum => {
    lineNum.addEventListener('click', () => {
      scrollToLine(parseInt(lineNum.dataset.line, 10));
    });
  });
  createFullViewerFindBar(content);
}

function destroyFullViewerFindBar() {
  if (fullViewerFindBar) {
    fullViewerFindBar.remove();
    fullViewerFindBar = null;
  }
  $('viewer')?.querySelectorAll('.code-line.full-find-match, .code-line.full-find-current')
    .forEach((line) => line.classList.remove('full-find-match', 'full-find-current'));
}

function fullViewerFindMatches(bar) {
  const query = bar?._mindgitInput?.value.toLocaleLowerCase() || '';
  if (!query) return [];
  const lines = String(bar._mindgitContent || '').split('\n');
  const matches = [];
  lines.forEach((line, lineIndex) => {
    const normalized = line.toLocaleLowerCase();
    let offset = normalized.indexOf(query);
    while (offset !== -1) {
      matches.push({ line: lineIndex + 1, column: offset + 1, length: query.length });
      offset = normalized.indexOf(query, offset + Math.max(1, query.length));
    }
  });
  return matches;
}

function renderFullViewerFindMatches(bar) {
  if (!bar) return;
  const matches = fullViewerFindMatches(bar);
  const lines = $('viewer')?.querySelectorAll('.code-line') || [];
  lines.forEach((line) => line.classList.remove('full-find-match', 'full-find-current'));
  matches.forEach((match) => {
    $('viewer')?.querySelector(`.code-line[data-line="${match.line}"]`)?.classList.add('full-find-match');
  });
  const currentIndex = Math.max(0, Math.min(bar._mindgitCurrentIndex, matches.length - 1));
  if (matches.length) {
    const current = matches[currentIndex];
    $('viewer')?.querySelector(`.code-line[data-line="${current.line}"]`)?.classList.add('full-find-current');
    bar._mindgitCurrentIndex = currentIndex;
    bar._mindgitCount.textContent = `${currentIndex + 1}/${matches.length}`;
  } else {
    bar._mindgitCurrentIndex = 0;
    bar._mindgitCount.textContent = '0/0';
  }
}

function selectFullViewerMatch(direction, fromStart = false) {
  const bar = fullViewerFindBar;
  if (!bar) return;
  const matches = fullViewerFindMatches(bar);
  if (!matches.length) {
    renderFullViewerFindMatches(bar);
    return;
  }
  const current = fromStart ? -1 : bar._mindgitCurrentIndex;
  bar._mindgitCurrentIndex = (current + direction + matches.length) % matches.length;
  const match = matches[bar._mindgitCurrentIndex];
  renderFullViewerFindMatches(bar);
  scrollToLine(match.line, { column: match.column, length: match.length });
}

function showFullViewerFindBar() {
  const bar = fullViewerFindBar;
  if (!bar) return false;
  bar.hidden = false;
  const selected = window.getSelection?.()?.toString() || '';
  if (selected && !bar._mindgitInput.value) bar._mindgitInput.value = selected;
  renderFullViewerFindMatches(bar);
  focusAndSelectField(bar._mindgitInput);
  return true;
}

function hideFullViewerFindBar() {
  if (!fullViewerFindBar) return;
  fullViewerFindBar.hidden = true;
  const lines = $('viewer')?.querySelectorAll('.code-line') || [];
  lines.forEach((line) => line.classList.remove('full-find-match', 'full-find-current', 'highlighted'));
  $('viewer')?.querySelector('#code-viewer-scroll')?.focus({ preventScroll: true });
}

function createFullViewerFindBar(content) {
  const host = $('viewer')?.querySelector('.code-viewer');
  if (!host) return;
  const bar = document.createElement('div');
  bar.className = 'viewer-find-bar';
  bar.hidden = true;
  bar.innerHTML = `
    <input class="viewer-find-input" type="text" placeholder="Find" autocomplete="off" />
    <span class="viewer-find-count">0/0</span>
    <button type="button" class="viewer-find-prev" title="Previous match">Prev</button>
    <button type="button" class="viewer-find-next" title="Next match">Next</button>
    <button type="button" class="viewer-find-close" title="Close">×</button>`;
  host.appendChild(bar);
  fullViewerFindBar = bar;
  bar._mindgitContent = content;
  bar._mindgitInput = bar.querySelector('.viewer-find-input');
  bar._mindgitCount = bar.querySelector('.viewer-find-count');
  bar._mindgitCurrentIndex = 0;
  bar._mindgitInput.addEventListener('input', () => {
    bar._mindgitCurrentIndex = 0;
    renderFullViewerFindMatches(bar);
    if (fullViewerFindMatches(bar).length) selectFullViewerMatch(1, true);
  });
  bar._mindgitInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      hideFullViewerFindBar();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      selectFullViewerMatch(event.shiftKey ? -1 : 1);
    }
  });
  bar.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      hideFullViewerFindBar();
    }
  });
  bar.querySelector('.viewer-find-prev').addEventListener('click', () => {
    selectFullViewerMatch(-1);
    focusWithoutScroll(bar._mindgitInput);
  });
  bar.querySelector('.viewer-find-next').addEventListener('click', () => {
    selectFullViewerMatch(1);
    focusWithoutScroll(bar._mindgitInput);
  });
  bar.querySelector('.viewer-find-close').addEventListener('click', hideFullViewerFindBar);
}

function isMarkdownFile(path) {
  const ext = path.split('.').pop().toLowerCase();
  return ['md', 'markdown', 'mdown', 'mkd', 'mkdn'].includes(ext);
}

function renderMarkdownContent(content, filename) {
  const context = {
    path: filename,
    headingIds: new Map(),
  };
  const html = renderMarkdownBlocks(normalizeMarkdownSource(content).split('\n'), context);
  $('viewer').innerHTML = `<div class="markdown-viewer-scroll" id="markdown-viewer-scroll" tabindex="-1">
    <article class="markdown-body">${html}</article>
  </div>`;
  attachScrollableInteractionTarget(getViewerScrollTarget());
}

function normalizeMarkdownSource(content) {
  return String(content || '').replace(/\r\n?/g, '\n');
}

function renderMarkdownBlocks(lines, context) {
  const blocks = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fenceMatch = line.match(/^\s{0,3}(```+|~~~+)\s*([A-Za-z0-9_+-]*)\s*$/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      const language = fenceMatch[2] || '';
      const codeLines = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^\\s{0,3}${escapeRegExp(fence)}\\s*$`).test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(renderMarkdownCodeBlock(codeLines.join('\n'), language));
      continue;
    }

    const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const id = uniqueMarkdownHeadingId(text, context.headingIds);
      blocks.push(`<h${level} id="${escapeAttr(id)}">${renderMarkdownInlines(text, context)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s{0,3}(?:\*\s*){3,}$/.test(line) || /^\s{0,3}(?:-\s*){3,}$/.test(line) || /^\s{0,3}(?:_\s*){3,}$/.test(line)) {
      blocks.push('<hr>');
      index += 1;
      continue;
    }

    if (/^\s*> ?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && (lines[index].trim() === '' || /^\s*> ?/.test(lines[index]))) {
        quoteLines.push(lines[index].replace(/^\s*> ?/, ''));
        index += 1;
      }
      blocks.push(`<blockquote>${renderMarkdownBlocks(quoteLines, context)}</blockquote>`);
      continue;
    }

    if (isMarkdownTableStart(lines, index)) {
      const tableLines = [lines[index], lines[index + 1]];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        tableLines.push(lines[index]);
        index += 1;
      }
      blocks.push(renderMarkdownTable(tableLines, context));
      continue;
    }

    if (matchMarkdownListItem(line)) {
      const parsed = renderMarkdownList(lines, index, context);
      blocks.push(parsed.html);
      index = parsed.nextIndex;
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockBoundary(lines, index)) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    if (!paragraphLines.length) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    const paragraph = paragraphLines.join('\n').replace(/ {2,}\n/g, '\u0000BR\u0000').replace(/\n/g, ' ');
    blocks.push(`<p>${renderMarkdownInlines(paragraph, context)}</p>`);
  }

  return blocks.join('');
}

function isMarkdownBlockBoundary(lines, index) {
  if (index <= 0) return false;
  const line = lines[index];
  return /^\s{0,3}(```+|~~~+)/.test(line)
    || /^\s{0,3}(#{1,6})\s+/.test(line)
    || /^\s*> ?/.test(line)
    || matchMarkdownListItem(line)
    || isMarkdownTableStart(lines, index)
    || /^\s{0,3}(?:\*\s*){3,}$/.test(line)
    || /^\s{0,3}(?:-\s*){3,}$/.test(line)
    || /^\s{0,3}(?:_\s*){3,}$/.test(line);
}

function renderMarkdownCodeBlock(code, language) {
  let html = escapeHTML(code);
  if (language && typeof hljs !== 'undefined') {
    try {
      html = hljs.highlight(code, { language, ignoreIllegals: true }).value;
    } catch {}
  }
  const langClass = language ? ` class="language-${escapeAttr(language)}"` : '';
  return `<pre><code${langClass}>${html}</code></pre>`;
}

function matchMarkdownListItem(line) {
  return line.match(/^(\s*)([*+-]|\d+\.)([ \t]+)(.*)$/);
}

function renderMarkdownList(lines, startIndex, context) {
  const firstMatch = matchMarkdownListItem(lines[startIndex]);
  const baseIndent = firstMatch[1].length;
  const ordered = /\d+\./.test(firstMatch[2]);
  const items = [];
  let nextIndex = startIndex;
  let hasTaskItems = false;

  while (nextIndex < lines.length) {
    const match = matchMarkdownListItem(lines[nextIndex]);
    if (!match || match[1].length !== baseIndent || /\d+\./.test(match[2]) !== ordered) {
      break;
    }

    const continuationIndent = match[1].length + match[2].length + match[3].length;
    const itemLines = [match[4]];
    nextIndex += 1;

    while (nextIndex < lines.length) {
      const current = lines[nextIndex];
      if (!current.trim()) {
        itemLines.push('');
        nextIndex += 1;
        continue;
      }

      const siblingMatch = matchMarkdownListItem(current);
      if (siblingMatch && siblingMatch[1].length <= baseIndent) {
        break;
      }

      const currentIndent = current.match(/^\s*/)[0].length;
      if (currentIndent <= baseIndent && (isMarkdownBlockBoundary(lines, nextIndex) || currentIndent < continuationIndent)) {
        break;
      }

      if (current.length >= continuationIndent) {
        itemLines.push(current.slice(continuationIndent));
      } else {
        itemLines.push(current.trimStart());
      }
      nextIndex += 1;
    }

    let itemClass = '';
    let prefix = '';
    const taskMatch = itemLines[0].match(/^\[( |x|X)\]\s+(.*)$/);
    if (taskMatch) {
      hasTaskItems = true;
      itemClass = ' class="task-list-item"';
      prefix = `<input type="checkbox" disabled${taskMatch[1].toLowerCase() === 'x' ? ' checked' : ''}>`;
      itemLines[0] = taskMatch[2];
    }

    const itemHTML = unwrapMarkdownListItem(renderMarkdownBlocks(itemLines, context));
    items.push(`<li${itemClass}>${prefix}${itemHTML}</li>`);
  }

  const listClass = hasTaskItems ? ' class="contains-task-list"' : '';
  const tag = ordered ? 'ol' : 'ul';
  return {
    html: `<${tag}${listClass}>${items.join('')}</${tag}>`,
    nextIndex,
  };
}

function unwrapMarkdownListItem(html) {
  const trimmed = html.trim();
  const match = trimmed.match(/^<p>([\s\S]*)<\/p>$/);
  return match ? match[1] : trimmed;
}

function isMarkdownTableStart(lines, index) {
  if (index + 1 >= lines.length) return false;
  if (!lines[index].includes('|')) return false;
  return /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(lines[index + 1]);
}

function renderMarkdownTable(lines, context) {
  const headerCells = splitMarkdownTableRow(lines[0]);
  const alignments = splitMarkdownTableRow(lines[1]).map((cell) => {
    const trimmed = cell.trim();
    if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
    if (trimmed.endsWith(':')) return 'right';
    return 'left';
  });
  const bodyRows = lines.slice(2).map(splitMarkdownTableRow);

  const renderCell = (tag, value, align, index) => {
    const style = align ? ` style="text-align:${align}"` : '';
    const content = renderMarkdownInlines((value ?? '').trim(), context);
    return `<${tag}${style}>${content || (tag === 'th' ? `Column ${index + 1}` : '')}</${tag}>`;
  };

  return `<table><thead><tr>${headerCells.map((cell, index) =>
    renderCell('th', cell, alignments[index] || 'left', index)).join('')}</tr></thead><tbody>${bodyRows.map((row) =>
    `<tr>${headerCells.map((_, index) => renderCell('td', row[index] || '', alignments[index] || 'left', index)).join('')}</tr>`).join('')}</tbody></table>`;
}

function splitMarkdownTableRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let current = '';
  let escaping = false;

  for (const char of trimmed) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === '\\') {
      escaping = true;
      current += char;
      continue;
    }
    if (char === '|') {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  cells.push(current);
  return cells;
}

function renderMarkdownInlines(source, context) {
  const placeholders = [];
  const stash = (html) => {
    const token = `\u0000MD${placeholders.length}\u0000`;
    placeholders.push(html);
    return token;
  };

  let text = String(source || '');

  text = text.replace(/(`+)([\s\S]*?)\1/g, (_, ticks, code) =>
    stash(`<code>${escapeHTML(code.replace(/\n/g, ' '))}</code>`));

  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+["']([^"']+)["'])?\)/g, (_, alt, destination, title) => {
    const link = resolveMarkdownLinkTarget(destination, context.path);
    if (!link?.href) return _;
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
    const src = link.type === 'local' ? markdownAssetURL(link.path) : link.href;
    return stash(`<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${titleAttr}>`);
  });

  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+["']([^"']+)["'])?\)/g, (_, label, destination, title) => {
    const link = resolveMarkdownLinkTarget(destination, context.path);
    if (!link?.href) return _;
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
    const localAttr = link.type === 'local' ? ` data-mindgit-path="${escapeAttr(link.path)}"` : '';
    const hashAttr = link.hash ? ` data-mindgit-hash="${escapeAttr(link.hash)}"` : '';
    const content = renderMarkdownInlines(label, context);
    return stash(`<a href="${escapeAttr(link.href)}"${titleAttr}${localAttr}${hashAttr}>${content}</a>`);
  });

  text = text.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, (_, href) =>
    stash(`<a href="${escapeAttr(href)}">${escapeHTML(href)}</a>`));

  const bareURLs = findURLsInText(text);
  if (bareURLs.length) {
    let rebuilt = '';
    let cursor = 0;
    for (const match of bareURLs) {
      rebuilt += text.slice(cursor, match.start);
      rebuilt += stash(`<a href="${escapeAttr(match.url)}">${escapeHTML(match.url)}</a>`);
      cursor = match.end;
    }
    rebuilt += text.slice(cursor);
    text = rebuilt;
  }

  text = escapeHTML(text);
  text = text.replace(/\u0000BR\u0000/g, '<br>');
  text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  text = text.replace(/(^|[^\w])\*\*([^\s][\s\S]*?[^\s])\*\*(?!\w)/g, '$1<strong>$2</strong>');
  text = text.replace(/(^|[^\w])__([^\s][\s\S]*?[^\s])__(?!\w)/g, '$1<strong>$2</strong>');
  text = text.replace(/(^|[^\w])\*([^\s][\s\S]*?[^\s])\*(?!\w)/g, '$1<em>$2</em>');
  text = text.replace(/(^|[^\w])_([^\s][\s\S]*?[^\s])_(?!\w)/g, '$1<em>$2</em>');
  text = text.replace(/\u0000MD(\d+)\u0000/g, (_, index) => placeholders[Number(index)] || '');
  return text;
}

function markdownAssetURL(path) {
  const url = new URL('/api/file', window.location.origin);
  url.searchParams.set('path', path);
  if (state.currentProjectKey) {
    url.searchParams.set('project', state.currentProjectKey);
  }
  return `${url.pathname}${url.search}`;
}

function resolveMarkdownLinkTarget(destination, currentPath) {
  const raw = String(destination || '').trim();
  if (!raw) return null;
  if (raw.startsWith('#')) {
    return { type: 'fragment', href: raw, hash: raw.slice(1) };
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) || raw.startsWith('//')) {
    return { type: 'external', href: raw };
  }

  const hashIndex = raw.indexOf('#');
  const hash = hashIndex >= 0 ? raw.slice(hashIndex + 1) : '';
  const pathPart = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const baseDir = currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/') + 1) : '';
  const candidate = pathPart.startsWith('/') ? pathPart.replace(/^\/+/, '') : `${baseDir}${pathPart}`;
  const resolvedPath = normalizeRepoRelativePath(candidate);
  if (!resolvedPath) {
    return null;
  }

  const href = new URL('/', window.location.origin);
  if (state.currentProjectKey) href.searchParams.set('project', state.currentProjectKey);
  href.searchParams.set('path', resolvedPath);
  href.searchParams.set('mode', 'full');
  if (hash) href.hash = hash;
  return {
    type: 'local',
    href: `${href.pathname}${href.search}${href.hash}`,
    path: resolvedPath,
    hash,
  };
}

function normalizeRepoRelativePath(path) {
  const parts = [];
  for (const segment of String(path || '').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!parts.length) return null;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join('/');
}

function uniqueMarkdownHeadingId(text, registry) {
  const base = slugifyMarkdownHeading(text) || 'section';
  const current = registry.get(base) || 0;
  registry.set(base, current + 1);
  return current ? `${base}-${current}` : base;
}

function slugifyMarkdownHeading(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[`*_~()[\]{}<>]/g, '')
    .replace(/[^\w\u4e00-\u9fff -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function measureMonospaceCharWidth(referenceEl) {
  if (!referenceEl) return 8;
  if (referenceEl._mindgitCharWidth) return referenceEl._mindgitCharWidth;

  const probe = document.createElement('span');
  const style = getComputedStyle(referenceEl);
  probe.textContent = 'M';
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.whiteSpace = 'pre';
  probe.style.font = style.font;
  probe.style.letterSpacing = style.letterSpacing;
  document.body.appendChild(probe);

  referenceEl._mindgitCharWidth = probe.getBoundingClientRect().width || 8;
  probe.remove();
  return referenceEl._mindgitCharWidth;
}

function scrollToLine(lineNumber, options = {}) {
  const viewer = $('viewer');
  const scrollContainer = viewer?.querySelector('#code-viewer-scroll') || viewer?.querySelector('pre');
  const metricsEl = viewer?.querySelector('.code-viewer-pre') || viewer?.querySelector('pre');
  if (!viewer || !scrollContainer || !metricsEl || !Number.isInteger(lineNumber) || lineNumber < 1) return false;
  const { column = 1, length = 1 } = options;

  viewer.querySelectorAll('.code-line.highlighted').forEach((el) => el.classList.remove('highlighted'));

  const targetLine = viewer.querySelector(`.code-line[data-line="${lineNumber}"]`);
  if (!targetLine) return false;

  targetLine.classList.add('highlighted');
  const targetTop = targetLine.offsetTop - ((scrollContainer.clientHeight - targetLine.offsetHeight) / 2);
  scrollContainer.scrollTop = Math.max(0, targetTop);

  const charWidth = measureMonospaceCharWidth(metricsEl);
  const focusColumn = Math.max(1, column);
  const focusWidth = Math.max(charWidth, Math.max(1, length) * charWidth);
  const targetLeft = targetLine.offsetLeft + ((focusColumn - 1) * charWidth) - ((scrollContainer.clientWidth - focusWidth) / 2);
  scrollContainer.scrollLeft = Math.max(0, targetLeft);
  return true;
}

async function search() {
  const query = $('search').value.trim();
  if (!query) return;
  try {
    setMessage('Searching...');
    const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
    if ($('search').value.trim() !== query) return;
    $('search-results').innerHTML = data.results.length ? data.results.map((result) => `
      <button data-search-path="${escapeAttr(result.path)}" data-search-line="${result.line}" data-search-column="${result.column}">
        <div class="where">${escapeHTML(result.path)}:${result.line}:${result.column}</div>
        <div class="preview">${escapeHTML(result.preview)}</div>
      </button>`).join('') : '<p>No matches</p>';
    for (const button of document.querySelectorAll('[data-search-path]')) {
      button.addEventListener('click', async () => {
        const lineNumber = parseInt(button.dataset.searchLine, 10);
        const columnNumber = parseInt(button.dataset.searchColumn, 10);
        await selectFile(button.dataset.searchPath, { mode: 'full', restoreState: false });
        if (Number.isInteger(lineNumber)) {
          scrollToLine(lineNumber, {
            column: Number.isInteger(columnNumber) ? columnNumber : 1,
            length: query.length,
          });
        }
      });
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
    return `<span class="${cls}">${linkifyPlainTextHTML(line)}</span>`;
  }).join('\n');
}
