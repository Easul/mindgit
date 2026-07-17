const terminalState = {
  initialized: false,
  loaded: false,
  activeId: '',
  clients: new Map(),
  ctrl: false,
  alt: false,
  selecting: false,
  height: Number(localStorage.getItem('mindgit-terminal-height')) || 360,
};

const terminalKeySequences = {
  escape: '\x1b',
  home: '\x1b[H',
  up: '\x1b[A',
  end: '\x1b[F',
  pageup: '\x1b[5~',
  tab: '\t',
  left: '\x1b[D',
  down: '\x1b[B',
  right: '\x1b[C',
  pagedown: '\x1b[6~',
};

function terminalTheme() {
  const dark = document.documentElement.dataset.theme !== 'light';
  return dark ? {
    background: '#0f1520',
    foreground: '#e6edf3',
    cursor: '#58a6ff',
    selectionBackground: '#264f78',
    black: '#0d1117',
    brightBlack: '#6e7681',
  } : {
    background: '#fffaf0',
    foreground: '#2c241b',
    cursor: '#0969da',
    selectionBackground: '#b6d7ff',
    black: '#2c241b',
    brightBlack: '#7d6f60',
  };
}

function syncTerminalTheme() {
  for (const client of terminalState.clients.values()) {
    client.terminal.options.theme = terminalTheme();
  }
}

function terminalWebSocketURL(client, id = '') {
  const url = new URL('/api/terminal', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (id) {
    url.searchParams.set('id', id);
  } else if (client?.sshName) {
    url.searchParams.set('ssh', client.sshName);
  } else if (state.currentProjectKey) {
    url.searchParams.set('project', state.currentProjectKey);
  }
  return url.toString();
}

function createTerminalClient(summary = null, options = {}) {
  const temporaryId = summary?.id || `pending-${Date.now()}-${Math.random()}`;
  const host = document.createElement('div');
  host.className = 'terminal-host';
  host.dataset.terminalId = temporaryId;
  $('terminal-hosts').appendChild(host);

  const terminal = new Terminal({
    allowProposedApi: false,
    cursorBlink: true,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: window.innerWidth <= 520 ? 13 : 14,
    scrollback: 5000,
    theme: terminalTheme(),
  });
  const fit = new FitAddon.FitAddon();
  terminal.loadAddon(fit);
  terminal.open(host);
  configureTerminalTextarea(terminal);
  const cleanupScrollbar = configureTerminalScrollbar(host);

  const client = {
    id: temporaryId,
    title: summary?.title || 'Starting…',
    projectKey: summary?.projectKey || state.currentProjectKey,
    project: summary?.project || currentProject()?.name || '',
    sshName: summary?.sshName || options.sshName || '',
    terminal,
    fit,
    host,
    socket: null,
    cleanupScrollbar,
    disposed: false,
    reconnectTimer: 0,
    ready: false,
    closed: Boolean(summary?.closed),
    ime: { composing: false, recoveryTimer: 0 },
  };
  terminalState.clients.set(temporaryId, client);
  configureTerminalInput(client);
  configureTerminalSelection(client);
  terminal.onSelectionChange(() => updateTerminalSelectButton());
  connectTerminal(client, summary?.id || '');
  renderTerminalTabs();
  activateTerminal(temporaryId);
  return client;
}

function configureTerminalScrollbar(host) {
  const viewport = host.querySelector('.xterm-viewport');
  if (!viewport) return () => {};

  let hideTimer = 0;
  const showScrollbar = () => {
    host.classList.add('scrollbar-active');
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => host.classList.remove('scrollbar-active'), 700);
  };
  const events = ['scroll', 'wheel', 'touchstart', 'pointerdown', 'pointerenter'];
  for (const eventName of events) {
    viewport.addEventListener(eventName, showScrollbar, { passive: true });
  }

  return () => {
    window.clearTimeout(hideTimer);
    for (const eventName of events) {
      viewport.removeEventListener(eventName, showScrollbar);
    }
  };
}

function connectTerminal(client, existingId) {
  if (client.disposed) return;
  const socket = new WebSocket(terminalWebSocketURL(client, existingId));
  socket.binaryType = 'arraybuffer';
  client.socket = socket;
  client.ready = false;

  socket.addEventListener('open', () => {
    if (existingId) client.terminal.reset();
  });
  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') {
      client.terminal.write(new Uint8Array(event.data));
      return;
    }
    const message = JSON.parse(event.data);
    if (message.type === 'ready') {
      const previousId = client.id;
      client.id = message.id;
      client.title = message.title;
      client.projectKey = message.projectKey;
      client.project = message.project;
      client.ready = true;
      client.closed = false;
      client.host.dataset.terminalId = client.id;
      if (previousId !== client.id) {
        terminalState.clients.delete(previousId);
        terminalState.clients.set(client.id, client);
        if (terminalState.activeId === previousId) terminalState.activeId = client.id;
      }
      renderTerminalTabs();
      requestAnimationFrame(() => fitTerminal(client));
    } else if (message.type === 'exit') {
      client.closed = true;
      window.setTimeout(() => closeTerminal(client.id), 0);
    }
  });
  socket.addEventListener('close', () => {
    client.ready = false;
    if (client.disposed || client.closed || !client.id || client.id.startsWith('pending-')) return;
    clearTimeout(client.reconnectTimer);
    client.reconnectTimer = window.setTimeout(() => connectTerminal(client, client.id), 1000);
  });
  socket.addEventListener('error', () => {
    if (!existingId) {
      client.terminal.writeln('\r\n\x1b[31mUnable to start terminal.\x1b[0m');
    }
  });
}

function sendTerminalInput(client, data) {
  if (!client?.ready || client.closed) return;
  let output = data;
  if (terminalState.ctrl && output.length === 1) {
    const code = output.toUpperCase().charCodeAt(0);
    if (code >= 64 && code <= 95) output = String.fromCharCode(code - 64);
  }
  if (terminalState.alt) output = `\x1b${output}`;
  sendTerminalMessage(client, { type: 'input', data: output });
  clearTerminalModifiers();
}

function configureTerminalInput(client) {
  const { terminal, ime } = client;
  const textarea = terminal.textarea;
  terminal.onData((data) => sendTerminalInput(client, data));
  if (!textarea) return;
  textarea.addEventListener('compositionstart', () => {
    ime.composing = true;
    window.clearTimeout(ime.recoveryTimer);
  });
  textarea.addEventListener('compositionend', () => {
    ime.composing = false;
    window.clearTimeout(ime.recoveryTimer);
    window.setTimeout(() => {
      if (!ime.composing) textarea.value = '';
    }, 0);
  });
  textarea.addEventListener('blur', () => {
    if (!ime.composing) return;
    textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '' }));
  });
  textarea.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !ime.composing) return;
    window.clearTimeout(ime.recoveryTimer);
    ime.recoveryTimer = window.setTimeout(() => {
      if (ime.composing) {
        textarea.dispatchEvent(new CompositionEvent('compositionend', { data: textarea.value }));
      }
    }, 120);
  });
}

function terminalCellFromPointer(client, event) {
  const screen = client.host.querySelector('.xterm-screen');
  if (!screen) return null;
  const rect = screen.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const column = Math.max(0, Math.min(client.terminal.cols - 1, Math.floor((event.clientX - rect.left) / rect.width * client.terminal.cols)));
  const viewportRow = Math.max(0, Math.min(client.terminal.rows - 1, Math.floor((event.clientY - rect.top) / rect.height * client.terminal.rows)));
  return {
    column,
    row: client.terminal.buffer.active.viewportY + viewportRow,
  };
}

function configureTerminalSelection(client) {
  let start = null;
  client.terminal.attachCustomKeyEventHandler((event) => {
    const key = event.key.toLowerCase();
    const isPasteShortcut = event.type === 'keydown'
      && key === 'v'
      && !event.altKey
      && (event.metaKey || event.ctrlKey);
    if (event.type === 'keydown' && (event.ctrlKey || event.metaKey) && !isPasteShortcut) {
      event.preventDefault();
    }
    const isCopyShortcut = event.type === 'keydown'
      && event.ctrlKey
      && event.shiftKey
      && !event.altKey
      && !event.metaKey
      && key === 'c';
    if (!isCopyShortcut) return true;
    event.preventDefault();
    event.stopPropagation();
    copyTerminalSelection(client);
    return false;
  });
  const update = (event) => {
    if (!start || !terminalState.selecting || client.id !== terminalState.activeId) return;
    const end = terminalCellFromPointer(client, event);
    if (!end) return;
    const cols = client.terminal.cols;
    const startOffset = start.row * cols + start.column;
    const endOffset = end.row * cols + end.column;
    const firstOffset = Math.min(startOffset, endOffset);
    const lastOffset = Math.max(startOffset, endOffset);
    client.terminal.select(firstOffset % cols, Math.floor(firstOffset / cols), lastOffset - firstOffset + 1);
  };
  client.host.addEventListener('pointerdown', (event) => {
    if (!terminalState.selecting || client.id !== terminalState.activeId) return;
    start = terminalCellFromPointer(client, event);
    if (!start) return;
    event.preventDefault();
    client.host.setPointerCapture?.(event.pointerId);
    client.terminal.clearSelection();
  });
  client.host.addEventListener('pointermove', (event) => {
    if (!start) return;
    event.preventDefault();
    update(event);
  });
  client.host.addEventListener('pointerup', (event) => {
    if (!start) return;
    event.preventDefault();
    update(event);
    start = null;
    client.host.releasePointerCapture?.(event.pointerId);
    updateTerminalSelectButton();
  });
  client.host.addEventListener('pointercancel', () => {
    start = null;
  });
}

function updateTerminalSelectButton() {
  const button = $('terminal-select');
  if (!button) return;
  const client = terminalState.clients.get(terminalState.activeId);
  const hasSelection = Boolean(client?.terminal.hasSelection());
  button.classList.toggle('active', terminalState.selecting || hasSelection);
  button.title = hasSelection ? 'Copy selected text' : (terminalState.selecting ? 'Cancel text selection' : 'Select terminal text');
  button.setAttribute('aria-label', button.title);
}

function setTerminalSelectionMode(enabled) {
  terminalState.selecting = enabled;
  for (const client of terminalState.clients.values()) {
    client.host.classList.toggle('selecting', enabled && client.id === terminalState.activeId);
  }
  updateTerminalSelectButton();
}

async function copyTerminalSelection(client) {
  const text = client?.terminal.getSelection();
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
  setMessage?.('Terminal selection copied', 'ok');
  client.terminal.clearSelection();
  setTerminalSelectionMode(false);
  client.terminal.focus();
  return true;
}

async function handleTerminalSelect() {
  const client = terminalState.clients.get(terminalState.activeId);
  if (!client) return;
  if (await copyTerminalSelection(client)) return;
  setTerminalSelectionMode(!terminalState.selecting);
  if (!terminalState.selecting) client.terminal.focus();
}

function sendTerminalMessage(client, message) {
  if (client?.socket?.readyState === WebSocket.OPEN) {
    client.socket.send(JSON.stringify(message));
  }
}

function renderTerminalTabs() {
  const tabs = $('terminal-tabs');
  if (!tabs) return;
  tabs.innerHTML = '';
  for (const client of terminalState.clients.values()) {
    const tab = document.createElement('div');
    tab.className = `terminal-tab${client.id === terminalState.activeId ? ' active' : ''}${client.closed ? ' closed' : ''}`;
    tab.setAttribute('role', 'tab');
    tab.title = client.project ? `${client.title} — ${client.project}` : client.title;

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'terminal-tab-select';
    select.textContent = client.project ? `${client.title} · ${client.project}` : client.title;
    select.addEventListener('click', () => activateTerminal(client.id));

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'terminal-tab-close';
    close.textContent = '×';
    close.title = 'Close terminal';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      closeTerminal(client.id);
    });
    tab.append(select, close);
    tabs.appendChild(tab);
  }
}

function activateTerminal(id) {
  const client = terminalState.clients.get(id);
  if (!client) return;
  terminalState.activeId = id;
  for (const item of terminalState.clients.values()) {
    item.host.classList.toggle('active', item === client);
    item.host.classList.toggle('selecting', terminalState.selecting && item === client);
  }
  renderTerminalTabs();
  updateTerminalSelectButton();
  requestAnimationFrame(() => {
    fitTerminal(client);
    if (!terminalState.selecting) client.terminal.focus();
  });
}

function fitTerminal(client = terminalState.clients.get(terminalState.activeId)) {
  if (!client || $('terminal-panel')?.hidden || !client.host.classList.contains('active')) return;
  try {
    client.fit.fit();
    sendTerminalMessage(client, {
      type: 'resize',
      cols: client.terminal.cols,
      rows: client.terminal.rows,
    });
  } catch {}
}

async function closeTerminal(id) {
  const client = terminalState.clients.get(id);
  if (!client) return;
  client.disposed = true;
  clearTimeout(client.reconnectTimer);
  clearTimeout(client.ime?.recoveryTimer);
  client.socket?.close();
  client.cleanupScrollbar?.();
  client.terminal.dispose();
  client.host.remove();
  terminalState.clients.delete(id);
  if (!id.startsWith('pending-')) {
    try {
      await fetch(`/api/terminal?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch {}
  }
  const next = terminalState.clients.values().next().value;
  terminalState.activeId = next?.id || '';
  renderTerminalTabs();
  if (next) activateTerminal(next.id);
  else hideTerminalPanel();
}

async function loadTerminalSessions() {
  if (terminalState.loaded) return;
  terminalState.loaded = true;
  try {
    const response = await fetch('/api/terminals', { cache: 'no-store' });
    const sessions = await response.json();
    if (response.ok && Array.isArray(sessions)) {
      for (const summary of sessions) createTerminalClient(summary);
    }
  } catch {}
}

async function openTerminalPanel(options = {}) {
  if (state.embed) return;
  initializeTerminalPanel();
  const panel = $('terminal-panel');
  panel.hidden = false;
  document.documentElement.dataset.terminalOpen = 'true';
  applyTerminalHeight();
  await loadTerminalSessions();
  let active = null;
  if (!options.newTab && !options.sshName) {
    active = [...terminalState.clients.values()].find((client) => (
      client.projectKey === state.currentProjectKey && !client.closed
    ));
  }
  if (!active) active = createTerminalClient(null, { sshName: options.sshName || '' });
  if (active) activateTerminal(active.id);
}

function hideTerminalPanel() {
  setTerminalSelectionMode(false);
  $('terminal-panel').hidden = true;
  delete document.documentElement.dataset.terminalOpen;
}

function initializeTerminalPanel() {
  if (terminalState.initialized) return;
  terminalState.initialized = true;
  $('terminal-select').addEventListener('click', handleTerminalSelect);
  $('terminal-new').addEventListener('click', () => openTerminalPanel({ newTab: true }));
  $('terminal-hide').addEventListener('click', hideTerminalPanel);
  $('terminal-keys-toggle').addEventListener('click', () => {
    const keys = $('terminal-extra-keys');
    keys.hidden = !keys.hidden;
    $('terminal-keys-toggle').classList.toggle('active', !keys.hidden);
    requestAnimationFrame(() => fitTerminal());
  });
  $('terminal-extra-keys').addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) event.preventDefault();
  });
  $('terminal-extra-keys').addEventListener('click', handleTerminalExtraKey);
  setupTerminalResizer();
  syncTerminalViewport();
  window.addEventListener('resize', () => {
    syncTerminalViewport();
    const active = terminalState.clients.get(terminalState.activeId);
    if (active) active.terminal.options.fontSize = window.innerWidth <= 520 ? 13 : 14;
    requestAnimationFrame(() => fitTerminal(active));
  });
  window.visualViewport?.addEventListener('resize', syncTerminalViewport);
  window.visualViewport?.addEventListener('scroll', syncTerminalViewport);
  document.addEventListener('keydown', preventTerminalBrowserShortcut, true);
}

function preventTerminalBrowserShortcut(event) {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (!document.documentElement.dataset.terminalOpen) return;
  const target = event.target instanceof Element ? event.target : null;
  const helperTextarea = target?.closest('.xterm-helper-textarea')
    || (document.activeElement?.classList.contains('xterm-helper-textarea') ? document.activeElement : null);
  if (!helperTextarea) return;
  const key = event.key.toLowerCase();
  const isPasteShortcut = key === 'v'
    && !event.altKey
    && (event.metaKey || event.ctrlKey);
  if (isPasteShortcut) return;
  if (event.ctrlKey && !event.metaKey && !event.altKey && key === 'w') {
    const host = helperTextarea.closest('.terminal-host');
    const client = [...terminalState.clients.values()].find((item) => item.host === host)
      || terminalState.clients.get(terminalState.activeId);
    event.preventDefault();
    event.stopImmediatePropagation();
    sendTerminalInput(client, '\x17');
    return;
  }
  event.preventDefault();
}

function handleTerminalExtraKey(event) {
  const modifier = event.target.closest('[data-terminal-modifier]')?.dataset.terminalModifier;
  if (modifier) {
    terminalState[modifier] = !terminalState[modifier];
    event.target.classList.toggle('active', terminalState[modifier]);
    terminalState.clients.get(terminalState.activeId)?.terminal.focus();
    return;
  }
  const key = event.target.closest('[data-terminal-key]')?.dataset.terminalKey;
  if (!key) return;
  const client = terminalState.clients.get(terminalState.activeId);
  sendTerminalInput(client, terminalKeySequences[key]);
  client?.terminal.focus();
}

function configureTerminalTextarea(terminal) {
  const textarea = terminal.textarea;
  if (!textarea) return;
  textarea.setAttribute('autocapitalize', 'off');
  textarea.setAttribute('autocomplete', 'off');
  textarea.setAttribute('autocorrect', 'off');
  textarea.setAttribute('spellcheck', 'false');
  textarea.setAttribute('enterkeyhint', 'enter');
  textarea.setAttribute('inputmode', 'text');
  textarea.setAttribute('lang', 'zh-CN');
  textarea.setAttribute('aria-label', 'Terminal input');
  textarea.addEventListener('focus', () => {
    document.documentElement.dataset.terminalInputFocused = 'true';
    syncTerminalViewport();
  });
  textarea.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (document.activeElement?.classList.contains('xterm-helper-textarea')) return;
      delete document.documentElement.dataset.terminalInputFocused;
      syncTerminalViewport();
    }, 0);
  });
}

function syncTerminalViewport() {
  const viewport = window.visualViewport;
  const viewportHeight = Math.round(viewport?.height || window.innerHeight);
  const viewportTop = Math.round(viewport?.offsetTop || 0);
  const viewportWidth = Math.round(viewport?.width || window.innerWidth);
  const viewportLeft = Math.round(viewport?.offsetLeft || 0);
  document.documentElement.style.setProperty('--terminal-viewport-top', `${viewportTop}px`);
  document.documentElement.style.setProperty('--terminal-viewport-height', `${viewportHeight}px`);
  document.documentElement.style.setProperty('--terminal-viewport-left', `${viewportLeft}px`);
  document.documentElement.style.setProperty('--terminal-viewport-width', `${viewportWidth}px`);
  document.documentElement.style.setProperty('--terminal-mobile-max-height', `${Math.max(180, Math.floor(viewportHeight * 0.55))}px`);
  requestAnimationFrame(() => fitTerminal());
}

function clearTerminalModifiers() {
  terminalState.ctrl = false;
  terminalState.alt = false;
  document.querySelectorAll('[data-terminal-modifier].active').forEach((button) => button.classList.remove('active'));
}

function applyTerminalHeight() {
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const max = Math.max(180, viewportHeight - 100);
  terminalState.height = Math.min(max, Math.max(220, terminalState.height));
  document.documentElement.style.setProperty('--terminal-height', `${terminalState.height}px`);
}

function setupTerminalResizer() {
  $('terminal-resizer').addEventListener('pointerdown', (event) => {
    const startY = event.clientY;
    const startHeight = terminalState.height;
    const move = (moveEvent) => {
      terminalState.height = startHeight + startY - moveEvent.clientY;
      applyTerminalHeight();
      fitTerminal();
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      localStorage.setItem('mindgit-terminal-height', String(terminalState.height));
      fitTerminal();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  });
}
