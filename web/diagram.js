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
    const data = await api(`/api/file?path=${encodeURIComponent(path)}`);
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

async function renderStructuredEdit(path) {
  if (isXmindFile(path)) {
    $('viewer').innerHTML = `<div class="binary-notice"><div><strong>Read Only</strong><p>XMind files can be browsed, but editing is not supported.</p></div></div>`;
    state.editorReady = false;
    updateEditButton('Save', { disabled: true, primary: true });
    return;
  }

  const data = await api(`/api/file?path=${encodeURIComponent(path)}`);
  state.content = data.content;
  if (isDrawioFile(path)) {
    renderDrawioViewer(data.content, path, true);
  } else {
    renderKmViewer(data.content, path, true);
  }
  state.editorReady = true;
  updateEditButton('Save', { disabled: state.saveInProgress, primary: true });
}

function structuredEditorContent() {
  const host = $('viewer')?.querySelector('[data-structured-editor="true"]');
  if (!host || typeof host._mindgitGetContent !== 'function') return null;
  return host._mindgitGetContent();
}

function renderDrawioViewer(content, path, editable) {
  if (typeof mxGraph === 'undefined' || typeof mxCodec === 'undefined') {
    renderDrawioLiteViewer(content, path, editable);
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
      language: 'xml',
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
  const graphNode = parsed.graphNode.cloneNode(true);
  let connectorSource = null;

  configureMxGraph(graph, editable);
  new mxCodec(graphNode.ownerDocument).decode(graphNode, graph.getModel());
  graph.fit();
  graph.center();
  attachWheelZoom(host, container, (direction) => direction > 0 ? graph.zoomOut() : graph.zoomIn());
  attachMiddlePan(container);

  if (editable) {
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

function attachStructuredShortcuts(host, handlers) {
  const listener = (event) => {
    if (!document.body.contains(host)) {
      document.removeEventListener('keydown', listener);
      return;
    }
    if (!event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 's') {
      event.preventDefault();
      saveFile();
    } else if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      handlers.undo?.();
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      handlers.redo?.();
    }
  };
  document.addEventListener('keydown', listener);
}

function attachWheelZoom(host, scrollEl, zoom) {
  host.addEventListener('wheel', (event) => {
    if (!event.altKey) return;
    event.preventDefault();
    zoom(event.deltaY);
  }, { passive: false });
}

function attachMiddlePan(scrollEl) {
  scrollEl.addEventListener('mousedown', (event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = scrollEl.scrollLeft;
    const startTop = scrollEl.scrollTop;
    scrollEl.classList.add('is-middle-panning');
    const move = (moveEvent) => {
      scrollEl.scrollLeft = startLeft - (moveEvent.clientX - startX);
      scrollEl.scrollTop = startTop - (moveEvent.clientY - startY);
    };
    const up = () => {
      scrollEl.classList.remove('is-middle-panning');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

function renderDrawioLiteViewer(content, path, editable) {
  const sourceContent = normalizeDrawioContent(content);
  const parsed = parseDrawioContent(sourceContent);
  if (!parsed.ok) {
    renderStructuredSourceEditor({
      title: displayName(path),
      message: parsed.error,
      content,
      editable,
      language: 'xml',
    });
    return;
  }

  const host = document.createElement('div');
  host.className = `structured-editor ${editable ? 'is-editable' : ''}`;
  host.dataset.structuredEditor = editable ? 'true' : 'false';
  host.innerHTML = `
    <div class="structured-toolbar">
      <strong>${escapeHTML(displayName(path))}</strong>
      <span>${editable ? 'Drawio Lite Editor' : 'Drawio Preview'}</span>
      ${editable ? `
        <button type="button" data-action="add-node">Add Node</button>
        <button type="button" data-action="add-edge">Add Edge</button>
        <button type="button" data-action="delete">Delete</button>
      ` : ''}
    </div>
    <div class="drawio-workspace">
      <svg class="drawio-edges" aria-hidden="true"></svg>
      <div class="drawio-nodes"></div>
    </div>`;
  $('viewer').innerHTML = '';
  $('viewer').appendChild(host);

  const model = parsed.model;
  const workspace = host.querySelector('.drawio-workspace');
  const edgeLayer = host.querySelector('.drawio-edges');
  const nodeLayer = host.querySelector('.drawio-nodes');
  let selectedId = model.nodes[0]?.id || '';
  let pendingEdgeSource = '';

  function render() {
    const bounds = drawioBounds(model.nodes);
    workspace.style.minWidth = `${bounds.width}px`;
    workspace.style.minHeight = `${bounds.height}px`;
    edgeLayer.setAttribute('width', String(bounds.width));
    edgeLayer.setAttribute('height', String(bounds.height));
    edgeLayer.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);

    edgeLayer.innerHTML = `
      <defs>
        <marker id="drawio-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" class="drawio-arrow-head"></path>
        </marker>
      </defs>
      ${model.edges.map((edge) => {
      const source = model.nodes.find((node) => node.id === edge.source);
      const target = model.nodes.find((node) => node.id === edge.target);
      if (!source || !target) return '';
      return `<path class="drawio-edge ${edge.id === selectedId ? 'active' : ''}" d="${drawioEdgePath(source, target)}" data-edge-id="${escapeAttr(edge.id)}" />`;
    }).join('')}`;

    nodeLayer.innerHTML = model.nodes.map((node) => `
      <button class="drawio-node ${drawioNodeClass(node)} ${node.id === selectedId ? 'active' : ''}" type="button" data-node-id="${escapeAttr(node.id)}"
        style="left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px">
        <span>${escapeHTML(node.value || 'Node')}</span>
      </button>`).join('');

    if (editable) bindDrawioNodeEvents();
  }

  function selectNode(nodeId) {
    if (pendingEdgeSource && pendingEdgeSource !== nodeId) {
      model.edges.push({ id: drawioNextId(model), source: pendingEdgeSource, target: nodeId, value: '' });
      pendingEdgeSource = '';
    }
    selectedId = nodeId;
    render();
  }

  function bindDrawioNodeEvents() {
    for (const nodeEl of nodeLayer.querySelectorAll('.drawio-node')) {
      nodeEl.addEventListener('click', () => selectNode(nodeEl.dataset.nodeId));
      nodeEl.addEventListener('dblclick', () => {
        const node = model.nodes.find((item) => item.id === nodeEl.dataset.nodeId);
        if (!node) return;
        const next = window.prompt('Node text', node.value || '');
        if (next !== null) {
          node.value = next;
          render();
        }
      });
      nodeEl.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        const node = model.nodes.find((item) => item.id === nodeEl.dataset.nodeId);
        if (!node) return;
        selectNode(node.id);
        const startX = event.clientX;
        const startY = event.clientY;
        const originalX = node.x;
        const originalY = node.y;
        nodeEl.setPointerCapture?.(event.pointerId);
        const move = (moveEvent) => {
          node.x = Math.max(0, originalX + moveEvent.clientX - startX);
          node.y = Math.max(0, originalY + moveEvent.clientY - startY);
          render();
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
      });
    }
  }

  if (editable) {
    host.querySelector('[data-action="add-node"]').addEventListener('click', () => {
      const id = drawioNextId(model);
      model.nodes.push({ id, value: 'New Node', x: 80 + model.nodes.length * 24, y: 80 + model.nodes.length * 24, width: 120, height: 54, style: 'rounded=1;whiteSpace=wrap;html=1;' });
      selectedId = id;
      render();
    });
    host.querySelector('[data-action="add-edge"]').addEventListener('click', () => {
      if (!model.nodes.some((node) => node.id === selectedId)) return;
      pendingEdgeSource = selectedId;
      setMessage('Select target node', 'ok');
    });
    host.querySelector('[data-action="delete"]').addEventListener('click', () => {
      model.nodes = model.nodes.filter((node) => node.id !== selectedId);
      model.edges = model.edges.filter((edge) => edge.id !== selectedId && edge.source !== selectedId && edge.target !== selectedId);
      selectedId = model.nodes[0]?.id || '';
      render();
    });
    host._mindgitGetContent = () => serializeDrawioModel(model, sourceContent);
  }

  render();
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

  const graph = firstXmlElement(doc, 'mxGraphModel');
  if (!graph) {
    return { ok: false, error: 'This drawio file uses compressed diagram data. The built-in lite editor supports uncompressed mxGraphModel files only.' };
  }

  const root = childXmlElement(graph, 'root');
  const cells = root ? childXmlElements(root, 'mxCell') : [];
  const nodes = cells.filter((cell) => cell.getAttribute('vertex') === '1').map((cell) => {
    const geometry = childXmlElement(cell, 'mxGeometry');
    return {
      id: cell.getAttribute('id') || '',
      value: cell.getAttribute('value') || '',
      style: cell.getAttribute('style') || '',
      x: Number(geometry?.getAttribute('x')) || 0,
      y: Number(geometry?.getAttribute('y')) || 0,
      width: Number(geometry?.getAttribute('width')) || 120,
      height: Number(geometry?.getAttribute('height')) || 54,
    };
  }).filter((node) => node.id);
  const edges = cells.filter((cell) => cell.getAttribute('edge') === '1').map((cell) => ({
    id: cell.getAttribute('id') || '',
    source: cell.getAttribute('source') || '',
    target: cell.getAttribute('target') || '',
    value: cell.getAttribute('value') || '',
    style: cell.getAttribute('style') || '',
  })).filter((edge) => edge.id);

  return { ok: true, graphNode: graph, model: { nodes, edges } };
}

function drawioBounds(nodes) {
  const maxX = Math.max(640, ...nodes.map((node) => node.x + node.width + 80));
  const maxY = Math.max(420, ...nodes.map((node) => node.y + node.height + 80));
  return { width: maxX, height: maxY };
}

function drawioEdgePath(source, target) {
  const sourceRight = source.x + source.width;
  const sourceLeft = source.x;
  const targetRight = target.x + target.width;
  const targetLeft = target.x;
  const sourceY = source.y + source.height / 2;
  const targetY = target.y + target.height / 2;
  const leftToRight = source.x + source.width / 2 <= target.x + target.width / 2;
  const x1 = leftToRight ? sourceRight : sourceLeft;
  const x2 = leftToRight ? targetLeft : targetRight;
  const midX = x1 + (x2 - x1) / 2;
  return `M ${x1} ${sourceY} H ${midX} V ${targetY} H ${x2}`;
}

function drawioNodeClass(node) {
  const style = node.style || '';
  return [
    style.includes('ellipse') ? 'shape-ellipse' : '',
    style.includes('rhombus') ? 'shape-diamond' : '',
    style.includes('rounded=1') ? 'shape-rounded' : '',
  ].filter(Boolean).join(' ');
}

function drawioNextId(model) {
  const used = new Set([...model.nodes.map((node) => node.id), ...model.edges.map((edge) => edge.id)]);
  let index = used.size + 2;
  while (used.has(String(index))) index++;
  return String(index);
}

function serializeDrawioModel(model, originalContent) {
  let doc = new DOMParser().parseFromString(normalizeDrawioContent(originalContent), 'application/xml');
  if (doc.querySelector('parsererror')) {
    doc = new DOMParser().parseFromString(emptyDrawioDocument(), 'application/xml');
  }
  let graph = firstXmlElement(doc, 'mxGraphModel');
  if (!graph) {
    doc = new DOMParser().parseFromString(emptyDrawioDocument(), 'application/xml');
    graph = firstXmlElement(doc, 'mxGraphModel');
  }

  let root = childXmlElement(graph, 'root');
  if (!root) {
    root = doc.createElement('root');
    graph.appendChild(root);
  }
  while (root.firstChild) root.removeChild(root.firstChild);
  appendDrawioBaseCell(doc, root, '0');
  appendDrawioBaseCell(doc, root, '1', '0');

  for (const node of model.nodes) {
    const cell = doc.createElement('mxCell');
    cell.setAttribute('id', node.id);
    cell.setAttribute('value', node.value || '');
    cell.setAttribute('style', node.style || 'rounded=1;whiteSpace=wrap;html=1;');
    cell.setAttribute('vertex', '1');
    cell.setAttribute('parent', '1');
    const geometry = doc.createElement('mxGeometry');
    geometry.setAttribute('x', String(Math.round(node.x)));
    geometry.setAttribute('y', String(Math.round(node.y)));
    geometry.setAttribute('width', String(Math.round(node.width)));
    geometry.setAttribute('height', String(Math.round(node.height)));
    geometry.setAttribute('as', 'geometry');
    cell.appendChild(geometry);
    root.appendChild(cell);
  }

  for (const edge of model.edges) {
    const cell = doc.createElement('mxCell');
    cell.setAttribute('id', edge.id);
    cell.setAttribute('value', edge.value || '');
    cell.setAttribute('style', edge.style || 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;');
    cell.setAttribute('edge', '1');
    cell.setAttribute('parent', '1');
    cell.setAttribute('source', edge.source);
    cell.setAttribute('target', edge.target);
    const geometry = doc.createElement('mxGeometry');
    geometry.setAttribute('relative', '1');
    geometry.setAttribute('as', 'geometry');
    cell.appendChild(geometry);
    root.appendChild(cell);
  }

  return new XMLSerializer().serializeToString(doc);
}

function appendDrawioBaseCell(doc, root, id, parent) {
  const cell = doc.createElement('mxCell');
  cell.setAttribute('id', id);
  if (parent) cell.setAttribute('parent', parent);
  root.appendChild(cell);
}

function xmlName(element) {
  return (element.localName || element.nodeName || '').toLowerCase();
}

function firstXmlElement(root, name) {
  const target = name.toLowerCase();
  return [...root.getElementsByTagName('*')].find((element) => xmlName(element) === target) || null;
}

function childXmlElement(root, name) {
  return childXmlElements(root, name)[0] || null;
}

function childXmlElements(root, name) {
  const target = name.toLowerCase();
  return [...root.children].filter((element) => xmlName(element) === target);
}

function renderKmViewer(content, path, editable) {
  let parsed;
  try {
    parsed = JSON.parse(content || '{}');
  } catch {
    renderStructuredSourceEditor({
      title: displayName(path),
      message: 'Invalid JSON. Use source editing to fix this KM file.',
      content,
      editable,
      language: 'json',
    });
    return;
  }

  let root = parsed.root || parsed;
  if (!root || typeof root !== 'object') {
    renderStructuredSourceEditor({
      title: displayName(path),
      message: 'Unsupported KM structure. Use source editing to edit raw JSON.',
      content,
      editable,
      language: 'json',
    });
    return;
  }

  const host = document.createElement('div');
  host.className = `structured-editor ${editable ? 'is-editable' : ''}`;
  host.dataset.structuredEditor = editable ? 'true' : 'false';
  host.innerHTML = `
    <div class="structured-toolbar">
      <strong>${escapeHTML(displayName(path))}</strong>
      <span>${editable ? 'KM Mind Map Editor' : 'KM Preview'}</span>
      ${editable ? `
        <button type="button" data-action="add-child">Add Child</button>
        <button type="button" data-action="add-sibling">Add Sibling</button>
        <button type="button" data-action="delete">Delete</button>
      ` : ''}
    </div>
    <div class="mindmap-canvas"></div>`;
  $('viewer').innerHTML = '';
  $('viewer').appendChild(host);

  const canvas = host.querySelector('.mindmap-canvas');
  let selectedNode = root;
  let zoom = 1;
  let history = [JSON.stringify(parsed)];
  let historyIndex = 0;

  function render() {
    canvas.innerHTML = renderMindNode(root, selectedNode, editable);
    canvas.style.setProperty('--mind-zoom', String(zoom));
    if (editable) bindMindNodeEvents();
  }

  function commitHistory() {
    const snapshot = JSON.stringify(parsed);
    if (history[historyIndex] === snapshot) return;
    history = history.slice(0, historyIndex + 1);
    history.push(snapshot);
    if (history.length > 100) history.shift();
    historyIndex = history.length - 1;
  }

  function restoreHistory(nextIndex) {
    if (nextIndex < 0 || nextIndex >= history.length) return;
    historyIndex = nextIndex;
    parsed = JSON.parse(history[historyIndex]);
    root = parsed.root || parsed;
    selectedNode = root;
    render();
  }

  function bindMindNodeEvents() {
    for (const nodeEl of canvas.querySelectorAll('[data-node-path]')) {
      nodeEl.addEventListener('click', (event) => {
        event.stopPropagation();
        selectedNode = mindNodeAtPath(root, nodeEl.dataset.nodePath) || root;
        render();
      });
      nodeEl.addEventListener('dblclick', (event) => {
        event.stopPropagation();
        const node = mindNodeAtPath(root, nodeEl.dataset.nodePath);
        if (!node) return;
        const next = window.prompt('Topic text', mindNodeText(node));
        if (next !== null) {
          setMindNodeText(node, next);
          commitHistory();
          render();
        }
      });
    }
  }

  if (editable) {
    host.querySelector('[data-action="add-child"]').addEventListener('click', () => {
      if (!Array.isArray(selectedNode.children)) selectedNode.children = [];
      const next = { data: { text: 'New Topic' }, children: [] };
      selectedNode.children.push(next);
      selectedNode = next;
      commitHistory();
      render();
    });
    host.querySelector('[data-action="add-sibling"]').addEventListener('click', () => {
      const parent = mindParentOf(root, selectedNode);
      if (!parent) return;
      if (!Array.isArray(parent.children)) parent.children = [];
      const next = { data: { text: 'New Topic' }, children: [] };
      parent.children.push(next);
      selectedNode = next;
      commitHistory();
      render();
    });
    host.querySelector('[data-action="delete"]').addEventListener('click', () => {
      const parent = mindParentOf(root, selectedNode);
      if (!parent || !Array.isArray(parent.children)) return;
      parent.children = parent.children.filter((child) => child !== selectedNode);
      selectedNode = parent;
      commitHistory();
      render();
    });
    attachStructuredShortcuts(host, {
      undo: () => restoreHistory(historyIndex - 1),
      redo: () => restoreHistory(historyIndex + 1),
    });
    host._mindgitGetContent = () => JSON.stringify(parsed, null, 2);
  }

  attachWheelZoom(host, canvas, (direction) => {
    zoom = Math.max(0.35, Math.min(2.5, direction > 0 ? zoom / 1.1 : zoom * 1.1));
    canvas.style.setProperty('--mind-zoom', String(zoom));
  });
  attachMiddlePan(canvas);
  render();
}

function renderMindNode(node, selectedNode, editable, path = '0') {
  const children = Array.isArray(node.children) ? node.children : [];
  return `
    <div class="mind-node-branch">
      <button class="mind-node ${node === selectedNode ? 'active' : ''}" type="button" ${editable ? `data-node-path="${path}"` : ''}>
        ${escapeHTML(mindNodeText(node))}
      </button>
      ${children.length ? `<div class="mind-node-children">${children.map((child, index) => renderMindNode(child, selectedNode, editable, `${path}.${index}`)).join('')}</div>` : ''}
    </div>`;
}

function mindNodeText(node) {
  return node?.data?.text || node?.title || node?.topic || node?.text || 'Topic';
}

function setMindNodeText(node, text) {
  if (node.data && typeof node.data === 'object') {
    node.data.text = text;
  } else if ('title' in node) {
    node.title = text;
  } else if ('topic' in node) {
    node.topic = text;
  } else {
    node.text = text;
  }
}

function mindNodeAtPath(root, path) {
  if (path === '0') return root;
  let node = root;
  for (const part of path.split('.').slice(1)) {
    const index = Number(part);
    if (!Array.isArray(node.children) || !node.children[index]) return null;
    node = node.children[index];
  }
  return node;
}

function mindParentOf(root, target) {
  if (root === target) return null;
  const children = Array.isArray(root.children) ? root.children : [];
  if (children.includes(target)) return root;
  for (const child of children) {
    const found = mindParentOf(child, target);
    if (found) return found;
  }
  return null;
}

function renderXmindViewer(content, path) {
  const sheets = Array.isArray(content) ? content : [content];
  const host = document.createElement('div');
  host.className = 'structured-editor';
  host.innerHTML = `
    <div class="structured-toolbar">
      <strong>${escapeHTML(displayName(path))}</strong>
      <span>XMind Preview</span>
    </div>
    <div class="xmind-sheets">
      ${sheets.map((sheet, index) => renderXmindSheet(sheet, index)).join('')}
    </div>`;
  $('viewer').innerHTML = '';
  $('viewer').appendChild(host);

  const canvas = host.querySelector('.xmind-sheets');
  let zoom = 1;
  canvas.style.setProperty('--mind-zoom', String(zoom));
  attachWheelZoom(host, canvas, (direction) => {
    zoom = Math.max(0.35, Math.min(2.5, direction > 0 ? zoom / 1.1 : zoom * 1.1));
    canvas.style.setProperty('--mind-zoom', String(zoom));
  });
  attachMiddlePan(canvas);
}

function renderXmindSheet(sheet, index) {
  const title = sheet?.title || `Sheet ${index + 1}`;
  const rootTopic = sheet?.rootTopic || sheet?.topic || sheet;
  return `
    <section class="xmind-sheet">
      <h3>${escapeHTML(title)}</h3>
      <div class="mindmap-canvas">${renderXmindTopic(rootTopic)}</div>
    </section>`;
}

function renderXmindTopic(topic) {
  if (!topic || typeof topic !== 'object') return '';
  const children = xmindChildren(topic);
  return `
    <div class="mind-node-branch">
      <div class="mind-node">${escapeHTML(topic.title || topic.text || 'Topic')}</div>
      ${children.length ? `<div class="mind-node-children">${children.map(renderXmindTopic).join('')}</div>` : ''}
    </div>`;
}

function xmindChildren(topic) {
  if (Array.isArray(topic.children)) return topic.children;
  if (Array.isArray(topic.children?.attached)) return topic.children.attached;
  if (Array.isArray(topic.children?.detached)) return topic.children.detached;
  return [];
}

function renderStructuredSourceEditor({ title, message, content, editable, language }) {
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
