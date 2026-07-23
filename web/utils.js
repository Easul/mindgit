function splitEditorLines(content) {
  return content === '' ? [''] : content.split('\n');
}

// Large documents need a cheaper rendering path to keep the browser responsive.
const LARGE_TEXT_DOCUMENT_BYTES = 512 * 1024;
const LARGE_TEXT_DOCUMENT_LINES = 10000;

function countTextLines(content, limit = Infinity) {
  if (!content) return 1;
  let lines = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      lines += 1;
      if (lines > limit) return lines;
    }
  }
  return lines;
}

function isLargeTextDocument(content) {
  const text = String(content || '');
  return text.length >= LARGE_TEXT_DOCUMENT_BYTES
    || countTextLines(text, LARGE_TEXT_DOCUMENT_LINES) > LARGE_TEXT_DOCUMENT_LINES;
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
let activePromptDialog = null;
let pendingBareAltKey = false;

function closeActionMenu() {
  if (!activeActionMenu) return;
  activeActionMenu.remove();
  activeActionMenu = null;
}

function closePromptDialog(result = null) {
  if (!activePromptDialog) return;
  const dialog = activePromptDialog;
  activePromptDialog = null;
  dialog.cleanup();
  dialog.resolve(result);
}

function isEditableTarget(target) {
  if (!target) return false;
  if (target instanceof HTMLInputElement) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (target.isContentEditable) return true;
  return false;
}

function shouldSuppressBareAlt(event) {
  if (event.key !== 'Alt') return false;
  if (event.ctrlKey || event.metaKey || event.shiftKey) return false;
  return !isEditableTarget(event.target);
}

function showPromptDialog(options = {}) {
  closeActionMenu();
  closePromptDialog(null);

  const {
    title = 'Input',
    message = '',
    value = '',
    placeholder = '',
    multiline = false,
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
    rows = 6,
  } = options;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'prompt-dialog-backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'prompt-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const titleEl = document.createElement('h3');
    titleEl.className = 'prompt-dialog-title';
    titleEl.textContent = title;
    dialog.appendChild(titleEl);

    if (message) {
      const messageEl = document.createElement('p');
      messageEl.className = 'prompt-dialog-message';
      messageEl.textContent = message;
      dialog.appendChild(messageEl);
    }

    const field = multiline ? document.createElement('textarea') : document.createElement('input');
    field.className = 'prompt-dialog-field';
    field.placeholder = placeholder;
    field.value = value;
    if (multiline) {
      field.rows = rows;
      field.spellcheck = false;
    } else {
      field.type = 'text';
      field.autocomplete = 'off';
      field.spellcheck = false;
    }
    dialog.appendChild(field);

    const actions = document.createElement('div');
    actions.className = 'prompt-dialog-actions';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = cancelLabel;
    cancelButton.addEventListener('click', () => closePromptDialog(null));
    actions.appendChild(cancelButton);

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'primary';
    confirmButton.textContent = confirmLabel;
    confirmButton.addEventListener('click', () => closePromptDialog(field.value));
    actions.appendChild(confirmButton);

    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const keydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePromptDialog(null);
        return;
      }

      if (multiline) {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          closePromptDialog(field.value);
        }
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        closePromptDialog(field.value);
      }
    };

    const overlayMouseDown = (event) => {
      if (event.target === overlay) {
        closePromptDialog(null);
      }
    };

    const cleanup = () => {
      document.removeEventListener('keydown', keydown, true);
      overlay.removeEventListener('mousedown', overlayMouseDown);
      overlay.remove();
    };

    activePromptDialog = { cleanup, resolve };
    document.addEventListener('keydown', keydown, true);
    overlay.addEventListener('mousedown', overlayMouseDown);

    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange?.(field.value.length, field.value.length);
    });
  });
}

function showConfirmDialog(options = {}) {
  closeActionMenu();
  closePromptDialog(null);

  const {
    title = 'Confirm',
    message = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
  } = options;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'prompt-dialog-backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'prompt-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const titleEl = document.createElement('h3');
    titleEl.className = 'prompt-dialog-title';
    titleEl.textContent = title;
    dialog.appendChild(titleEl);

    if (message) {
      const messageEl = document.createElement('p');
      messageEl.className = 'prompt-dialog-message';
      messageEl.textContent = message;
      dialog.appendChild(messageEl);
    }

    const actions = document.createElement('div');
    actions.className = 'prompt-dialog-actions';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = cancelLabel;
    cancelButton.addEventListener('click', () => closePromptDialog(false));
    actions.appendChild(cancelButton);

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = danger ? 'danger' : 'primary';
    confirmButton.textContent = confirmLabel;
    confirmButton.addEventListener('click', () => closePromptDialog(true));
    actions.appendChild(confirmButton);

    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const keydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePromptDialog(false);
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        closePromptDialog(true);
      }
    };

    const overlayMouseDown = (event) => {
      if (event.target === overlay) {
        closePromptDialog(false);
      }
    };

    const cleanup = () => {
      document.removeEventListener('keydown', keydown, true);
      overlay.removeEventListener('mousedown', overlayMouseDown);
      overlay.remove();
    };

    activePromptDialog = { cleanup, resolve };
    document.addEventListener('keydown', keydown, true);
    overlay.addEventListener('mousedown', overlayMouseDown);

    requestAnimationFrame(() => {
      confirmButton.focus();
    });
  });
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
    button.textContent = window.t ? window.t(item.label) : item.label;
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

function fileStatusBaseCode(file) {
  if (!file) return '';
  return file.indexStatus || file.worktreeStatus || file.status || '';
}

function fileStatusLabel(file) {
  const base = fileStatusBaseCode(file);
  if (!base) return '';
  return file.staged && file.unstaged ? `${base}+` : base;
}

function fileStatusClasses(file) {
  const base = fileStatusBaseCode(file) || file?.status || '';
  return [
    'status',
    base,
    file?.staged ? 'staged' : '',
    file?.staged && file?.unstaged ? 'mixed' : '',
  ].filter(Boolean).join(' ');
}

function describeFileStatus(file) {
  const base = fileStatusBaseCode(file) || file?.status || 'M';
  const labels = {
    A: file?.staged ? 'Staged addition' : 'Added',
    D: file?.staged ? 'Staged deletion' : 'Deleted',
    M: file?.staged ? 'Staged modification' : 'Modified',
    U: 'Untracked',
    I: 'Ignored',
  };

  if (file?.staged && file?.unstaged) {
    return `${window.t ? window.t(labels[base] || 'Staged change') : labels[base] || 'Staged change'}, ${window.t ? window.t('with unstaged changes') : 'with unstaged changes'}`;
  }
  const label = labels[base] || 'Modified';
  return window.t ? window.t(label) : label;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function escapeAttr(value) {
  return escapeHTML(value).replace(/'/g, '&#39;');
}

function hasOpenLinkModifier(event) {
  return Boolean((event?.ctrlKey || event?.metaKey) && !event?.altKey);
}

function trimPlainTextURL(url) {
  let trimmed = String(url || '');

  while (/[.,!?;:]+$/.test(trimmed)) {
    trimmed = trimmed.slice(0, -1);
  }

  const balancePairs = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ];

  for (const [openChar, closeChar] of balancePairs) {
    while (trimmed.endsWith(closeChar)) {
      const opens = (trimmed.match(new RegExp(`\\${openChar}`, 'g')) || []).length;
      const closes = (trimmed.match(new RegExp(`\\${closeChar}`, 'g')) || []).length;
      if (closes <= opens) break;
      trimmed = trimmed.slice(0, -1);
    }
  }

  return trimmed;
}

function findURLsInText(text) {
  const source = String(text || '');
  const regex = /\b(?:https?:\/\/|mailto:)[^\s<>"'`]+/gi;
  const matches = [];
  let match;

  while ((match = regex.exec(source)) !== null) {
    const raw = match[0];
    const trimmed = trimPlainTextURL(raw);
    if (!trimmed) continue;
    matches.push({
      url: trimmed,
      start: match.index,
      end: match.index + trimmed.length,
    });
    regex.lastIndex = match.index + raw.length;
  }

  return matches;
}

function urlMatchAtPosition(text, position) {
  if (!Number.isInteger(position) || position < 0) return null;
  return findURLsInText(text).find((match) => position >= match.start && position < match.end) || null;
}

function linkifyPlainTextHTML(text) {
  const source = String(text || '');
  const matches = findURLsInText(source);
  if (!matches.length) return escapeHTML(source);

  let html = '';
  let cursor = 0;

  for (const match of matches) {
    html += escapeHTML(source.slice(cursor, match.start));
    html += `<a href="${escapeAttr(match.url)}">${escapeHTML(match.url)}</a>`;
    cursor = match.end;
  }

  html += escapeHTML(source.slice(cursor));
  return html;
}

document.addEventListener('click', (event) => {
  if (activeActionMenu && !event.target.closest('.action-menu')) {
    closeActionMenu();
  }
});
document.addEventListener('keydown', (event) => {
  if (!shouldSuppressBareAlt(event)) {
    pendingBareAltKey = false;
    return;
  }
  pendingBareAltKey = true;
  event.preventDefault();
}, true);
document.addEventListener('keyup', (event) => {
  if (event.key !== 'Alt') return;
  if (!pendingBareAltKey) return;
  pendingBareAltKey = false;
  event.preventDefault();
}, true);
window.addEventListener('blur', () => {
  pendingBareAltKey = false;
});
window.addEventListener('resize', closeActionMenu);
window.addEventListener('scroll', (event) => {
  if (activeActionMenu && (event.target === activeActionMenu || activeActionMenu.contains(event.target))) {
    return;
  }
  closeActionMenu();
}, true);
