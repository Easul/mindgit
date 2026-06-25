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
