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

let activeActionMenu = null;

function closeActionMenu() {
  if (!activeActionMenu) return;
  activeActionMenu.remove();
  activeActionMenu = null;
}

function showActionMenu(anchor, items) {
  closeActionMenu();

  const menu = document.createElement('div');
  menu.className = 'action-menu';
  menu.setAttribute('role', 'menu');

  for (const item of items) {
    if (item.separator) {
      const separator = document.createElement('div');
      separator.className = 'action-menu-separator';
      menu.appendChild(separator);
      continue;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = [
      'action-menu-item',
      item.active ? 'active' : '',
      item.danger ? 'danger' : '',
    ].filter(Boolean).join(' ');
    button.disabled = Boolean(item.disabled);
    button.textContent = item.label;
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      closeActionMenu();
      if (typeof item.action === 'function') {
        await item.action();
      }
    });
    menu.appendChild(button);
  }

  document.body.appendChild(menu);
  activeActionMenu = menu;
  positionActionMenu(anchor, menu);
}

function positionActionMenu(anchor, menu) {
  const rect = anchor.getBoundingClientRect();
  const margin = 6;
  const menuRect = menu.getBoundingClientRect();
  const left = Math.min(window.innerWidth - menuRect.width - margin, Math.max(margin, rect.right - menuRect.width));
  const top = Math.min(window.innerHeight - menuRect.height - margin, rect.bottom + margin);
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(margin, top)}px`;
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

document.addEventListener('click', (event) => {
  if (activeActionMenu && !event.target.closest('.action-menu')) {
    closeActionMenu();
  }
});
window.addEventListener('resize', closeActionMenu);
window.addEventListener('scroll', closeActionMenu, true);
