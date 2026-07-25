let mxGraphLoadPromise = null;

function ensureMxGraphAssets() {
  if (typeof mxGraph !== 'undefined' && typeof mxCodec !== 'undefined') return Promise.resolve(true);
  if (!mxGraphLoadPromise) {
    mxGraphLoadPromise = loadScriptOnce(
      '/vendor/mxgraph/mxClient.min.js',
      () => typeof mxGraph !== 'undefined' && typeof mxCodec !== 'undefined',
    ).then(() => true).catch(() => false);
  }
  return mxGraphLoadPromise;
}

function renderDrawioViewer(content, path, editable) {
  if (typeof mxGraph === 'undefined' || typeof mxCodec === 'undefined') {
    renderStructuredSourceEditor({
      title: displayName(path),
      message: 'mxGraph failed to load. Edit the XML source directly.',
      content,
      editable,
    });
    return;
  }

  const sourceContent = normalizeDrawioContent(content);
  const parsed = parseDrawioContent(sourceContent);
  if (!parsed.ok) {
    renderStructuredSourceEditor({
      title: displayName(path),
      message: parsed.error,
      content,
      editable,
    });
    return;
  }

  const host = document.createElement('div');
  host.className = `structured-editor mxgraph-editor ${editable ? 'is-editable' : ''}`;
  host.dataset.structuredEditor = editable ? 'true' : 'false';
  host.innerHTML = `
    <div class="structured-toolbar">
      <strong>${escapeHTML(displayName(path))}</strong>
      <span>${editable ? 'mxGraph Drawio Editor' : 'Drawio Preview'}</span>
      ${editable ? `
        <button type="button" data-action="rectangle">Rectangle</button>
        <button type="button" data-action="rounded">Rounded</button>
        <button type="button" data-action="circle">Circle</button>
        <button type="button" data-action="ellipse">Ellipse</button>
        <button type="button" data-action="connect">Connect</button>
        <button type="button" data-action="delete">Delete</button>
      ` : ''}
    </div>
    <div class="mxgraph-canvas"></div>`;
  $('viewer').innerHTML = '';
  $('viewer').appendChild(host);

  const container = host.querySelector('.mxgraph-canvas');
  const graph = new mxGraph(container);
  host._mindgitGraph = graph;
  let connectorSource = null;

  configureMxGraph(graph, editable);
  new mxCodec(parsed.graphNode.ownerDocument).decode(parsed.graphNode.cloneNode(true), graph.getModel());
  graph.fit();
  graph.center();
  attachWheelZoom(host, container, (direction) => direction > 0 ? graph.zoomOut() : graph.zoomIn());
  attachMiddlePan(container);

  if (!editable) return;

  const undoManager = createMxUndoManager(graph);
  const parent = graph.getDefaultParent();
  host.querySelector('[data-action="rectangle"]').addEventListener('click', () => insertMxVertex(graph, parent, 'Process', 'whiteSpace=wrap;html=1;rounded=0;', 150, 70));
  host.querySelector('[data-action="rounded"]').addEventListener('click', () => insertMxVertex(graph, parent, 'Step', 'rounded=1;whiteSpace=wrap;html=1;', 150, 70));
  host.querySelector('[data-action="circle"]').addEventListener('click', () => insertMxVertex(graph, parent, 'Circle', 'shape=ellipse;perimeter=ellipsePerimeter;whiteSpace=wrap;html=1;', 90, 90));
  host.querySelector('[data-action="ellipse"]').addEventListener('click', () => insertMxVertex(graph, parent, 'Ellipse', 'shape=ellipse;perimeter=ellipsePerimeter;whiteSpace=wrap;html=1;', 160, 90));
  host.querySelector('[data-action="connect"]').addEventListener('click', () => {
    connectorSource = graph.getSelectionCell();
    if (!connectorSource || !graph.getModel().isVertex(connectorSource)) {
      setMessage('Select a source node first', 'error');
      connectorSource = null;
      return;
    }
    setMessage('Select target node', 'ok');
  });
  host.querySelector('[data-action="delete"]').addEventListener('click', () => graph.removeCells());
  graph.getSelectionModel().addListener(mxEvent.CHANGE, () => {
    const target = graph.getSelectionCell();
    if (!connectorSource || !target || connectorSource === target || !graph.getModel().isVertex(target)) return;
    graph.getModel().beginUpdate();
    try {
      graph.insertEdge(parent, null, '', connectorSource, target);
    } finally {
      graph.getModel().endUpdate();
    }
    connectorSource = null;
  });
  attachStructuredShortcuts(host, {
    undo: () => undoManager.undo(),
    redo: () => undoManager.redo(),
  });
  host._mindgitGetContent = () => serializeMxGraph(graph, sourceContent);
}

function configureMxGraph(graph, editable) {
  mxEvent.disableContextMenu(graph.container);
  graph.setEnabled(editable);
  graph.setPanning(true);
  graph.setTooltips(false);
  graph.setConnectable(editable);
  graph.setAllowDanglingEdges(false);
  graph.setCellsCloneable(false);
  graph.setMultigraph(false);
  graph.gridEnabled = true;
  graph.gridSize = 10;
  graph.keepEdgesInBackground = true;

  graph.getStylesheet().getDefaultVertexStyle()[mxConstants.STYLE_FILLCOLOR] = '#f8fafc';
  graph.getStylesheet().getDefaultVertexStyle()[mxConstants.STYLE_STROKECOLOR] = '#64748b';
  graph.getStylesheet().getDefaultVertexStyle()[mxConstants.STYLE_FONTCOLOR] = '#0f172a';
  graph.getStylesheet().getDefaultEdgeStyle()[mxConstants.STYLE_ROUNDED] = true;
  graph.getStylesheet().getDefaultEdgeStyle()[mxConstants.STYLE_EDGE] = mxEdgeStyle.OrthConnector;
  graph.getStylesheet().getDefaultEdgeStyle()[mxConstants.STYLE_STROKECOLOR] = '#64748b';
  graph.getStylesheet().getDefaultEdgeStyle()[mxConstants.STYLE_ENDARROW] = mxConstants.ARROW_BLOCK;

  if (editable) {
    new mxRubberband(graph);
    const keyHandler = new mxKeyHandler(graph);
    keyHandler.bindKey(46, () => graph.removeCells());
    keyHandler.bindKey(8, () => graph.removeCells());
  }
}

function createMxUndoManager(graph) {
  const undoManager = new mxUndoManager();
  const listener = (_sender, event) => undoManager.undoableEditHappened(event.getProperty('edit'));
  graph.getModel().addListener(mxEvent.UNDO, listener);
  graph.getView().addListener(mxEvent.UNDO, listener);
  return undoManager;
}

function insertMxVertex(graph, parent, label, style, width = 140, height = 70) {
  const reference = selectedOrLastMxVertex(graph, parent);
  const x = reference
    ? Math.round((reference.geometry.x + reference.geometry.width + 40) / 10) * 10
    : Math.max(40, Math.round((graph.container.scrollLeft / graph.view.scale + 80) / 10) * 10);
  const y = reference
    ? Math.round(reference.geometry.y / 10) * 10
    : Math.max(40, Math.round((graph.container.scrollTop / graph.view.scale + 80) / 10) * 10);
  graph.getModel().beginUpdate();
  try {
    const cell = graph.insertVertex(parent, null, label, x, y, width, height, style);
    graph.setSelectionCell(cell);
  } finally {
    graph.getModel().endUpdate();
  }
}

function selectedOrLastMxVertex(graph, parent) {
  const selected = graph.getSelectionCell();
  if (selected && graph.getModel().isVertex(selected) && selected.geometry) return selected;
  const vertices = graph.getChildVertices(parent).filter((cell) => cell.geometry);
  return vertices[vertices.length - 1] || null;
}

function serializeMxGraph(graph, originalContent) {
  const modelNode = new mxCodec().encode(graph.getModel());
  const modelXml = mxUtils.getXml(modelNode);
  const doc = new DOMParser().parseFromString(normalizeDrawioContent(originalContent), 'application/xml');
  const existing = firstXmlElement(doc, 'mxGraphModel');
  if (!existing) return modelXml;
  const next = new DOMParser().parseFromString(modelXml, 'application/xml').documentElement;
  existing.parentNode.replaceChild(doc.importNode(next, true), existing);
  return new XMLSerializer().serializeToString(doc);
}

function normalizeDrawioContent(content) {
  return content.trim() ? content : emptyDrawioDocument();
}

function emptyDrawioDocument() {
  return `<mxfile><diagram name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`;
}

function parseDrawioContent(content) {
  const doc = new DOMParser().parseFromString(content, 'application/xml');
  if (doc.querySelector('parsererror')) {
    return { ok: false, error: 'Invalid XML. Use source editing to fix this file.' };
  }

  const graphNode = firstXmlElement(doc, 'mxGraphModel');
  if (!graphNode) {
    return { ok: false, error: 'This drawio file uses compressed diagram data. Use source editing to edit the raw file.' };
  }
  return { ok: true, graphNode };
}

function xmlName(element) {
  return (element.localName || element.nodeName || '').toLowerCase();
}

function firstXmlElement(root, name) {
  const target = name.toLowerCase();
  return [...root.getElementsByTagName('*')].find((element) => xmlName(element) === target) || null;
}
