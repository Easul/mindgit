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
  const text = topic.title || topic.text || 'Topic';
  return `<div class="mind-node-branch"><div class="mind-node" title="${escapeHTML(text)}">${escapeHTML(text)}</div>${children.length ? `<div class="mind-node-children">${children.map(renderXmindTopic).join('')}</div>` : ''}</div>`;
}

function xmindChildren(topic) {
  if (Array.isArray(topic.children)) return topic.children;
  if (Array.isArray(topic.children?.attached)) return topic.children.attached;
  if (Array.isArray(topic.children?.detached)) return topic.children.detached;
  return [];
}
