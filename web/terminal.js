const terminalState = {
  initialized: false,
  loaded: false,
  activeId: '',
  clients: new Map(),
  ctrl: false,
  alt: false,
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

function terminalWebSocketURL(id = '') {
  const url = new URL('/api/terminal', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (id) {
    url.searchParams.set('id', id);
  } else if (state.currentProjectKey) {
    url.searchParams.set('project', state.currentProjectKey);
  }
  return url.toString();
}

function createTerminalClient(summary = null) {
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

  const client = {
    id: temporaryId,
    title: summary?.title || 'Starting…',
    project: summary?.project || currentProject()?.name || '',
    terminal,
    fit,
    host,
    socket: null,
    disposed: false,
    reconnectTimer: 0,
    ready: false,
    closed: Boolean(summary?.closed),
  };
  terminalState.clients.set(temporaryId, client);
  terminal.onData((data) => sendTerminalInput(client, data));
  connectTerminal(client, summary?.id || '');
  renderTerminalTabs();
  activateTerminal(temporaryId);
  return client;
}

function connectTerminal(client, existingId) {
  if (client.disposed) return;
  const socket = new WebSocket(terminalWebSocketURL(existingId));
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
  }
  renderTerminalTabs();
  requestAnimationFrame(() => {
    fitTerminal(client);
    client.terminal.focus();
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
  client.socket?.close();
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
  if (options.newTab || terminalState.clients.size === 0) createTerminalClient();
  const active = terminalState.clients.get(terminalState.activeId) || terminalState.clients.values().next().value;
  if (active) activateTerminal(active.id);
}

function hideTerminalPanel() {
  $('terminal-panel').hidden = true;
  delete document.documentElement.dataset.terminalOpen;
}

function initializeTerminalPanel() {
  if (terminalState.initialized) return;
  terminalState.initialized = true;
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
  window.addEventListener('resize', () => {
    const active = terminalState.clients.get(terminalState.activeId);
    if (active) active.terminal.options.fontSize = window.innerWidth <= 520 ? 13 : 14;
    requestAnimationFrame(() => fitTerminal(active));
  });
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
}

function clearTerminalModifiers() {
  terminalState.ctrl = false;
  terminalState.alt = false;
  document.querySelectorAll('[data-terminal-modifier].active').forEach((button) => button.classList.remove('active'));
}

function applyTerminalHeight() {
  const max = Math.max(220, window.innerHeight - 100);
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
