function splitEditorLines(content) {
  return content === '' ? [''] : content.split('\n');
}

function renderLineNumberSpans(count, className) {
  return Array.from({length: count}, (_, i) =>
    `<span class="${className}" data-line="${i + 1}">${i + 1}</span>`
  ).join('');
}

function getLineStartPositionFromLines(lines, lineNum) {
  let pos = 0;
  for (let i = 0; i < lineNum - 1; i++) {
    pos += lines[i].length + 1;
  }
  return pos;
}

function setMessage(text, type = '') {
  $('message').textContent = text;
  $('message').className = `message ${type}`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function escapeAttr(value) {
  return escapeHTML(value).replace(/'/g, '&#39;');
}
