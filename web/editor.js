function setupEditorShortcuts(editor) {
  const LINE_HEIGHT = 20;
  const EDITOR_PADDING_TOP = 16;
  const lineNumbersEl = $('editor-line-numbers');
  const lineGutterEl = $('editor-line-gutter');
  const lineHighlight = $('editor-line-highlight');
  const blockSelectionOverlay = createBlockSelectionOverlay(editor);
  const commandBar = createEditorCommandBar(editor);

  let undoStack = [{
    value: editor.value,
    start: editor.selectionStart,
    end: editor.selectionEnd,
  }];
  let redoStack = [];
  let lastValue = editor.value;
  let isUndoRedo = false;
  let blockSelection = null;

  function syncEditorChrome() {
    if (lineNumbersEl) {
      lineNumbersEl.style.transform = `translateY(${-editor.scrollTop}px)`;
    }
  }

  function revealEditorRange(start, end = start) {
    centerEditorSelection(editor, start, end, LINE_HEIGHT);
    syncEditorChrome();
  }

  function updateCurrentLineHighlight(lineNum) {
    if (!lineHighlight) return;
    const top = EDITOR_PADDING_TOP + ((lineNum - 1) * LINE_HEIGHT) - editor.scrollTop;
    lineHighlight.style.top = `${top}px`;
    lineHighlight.style.display = 'block';
  }

  function recordHistoryState() {
    if (editor.value === lastValue) return;
    undoStack.push({
      value: editor.value,
      start: editor.selectionStart,
      end: editor.selectionEnd,
    });
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
    lastValue = editor.value;
  }

  function resetHistoryState() {
    undoStack = [{
      value: editor.value,
      start: editor.selectionStart,
      end: editor.selectionEnd,
    }];
    redoStack = [];
    lastValue = editor.value;
  }

  function recordSelectionHistoryState() {
    const current = undoStack[undoStack.length - 1];
    if (
      current &&
      current.value === editor.value &&
      current.start === editor.selectionStart &&
      current.end === editor.selectionEnd
    ) {
      return;
    }

    undoStack.push({
      value: editor.value,
      start: editor.selectionStart,
      end: editor.selectionEnd,
    });
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
  }

  function restoreHistoryState(historyState) {
    isUndoRedo = true;
    editor.value = historyState.value;
    lastValue = historyState.value;
    updateEditor();
    const start = historyState.start ?? historyState.cursor ?? 0;
    const end = historyState.end ?? start;
    editor.setSelectionRange(start, end);
    isUndoRedo = false;
  }

  function commitEditorChange() {
    updateEditor();
    recordHistoryState();
  }

  function clearBlockSelection() {
    blockSelection = null;
    renderBlockSelection(editor, blockSelectionOverlay, blockSelection, LINE_HEIGHT);
  }

  function setBlockSelection(nextSelection) {
    blockSelection = nextSelection;
    const focusPos = getPositionFromRowCol(editor, blockSelection.focus.row, blockSelection.focus.col);
    editor.setSelectionRange(focusPos, focusPos);
    renderBlockSelection(editor, blockSelectionOverlay, blockSelection, LINE_HEIGHT);
  }

  if (lineGutterEl) {
    lineGutterEl.addEventListener('click', (e) => {
      const lineNumSpan = e.target.closest('.editor-line-num');
      if (!lineNumSpan) return;

      const lineNum = parseInt(lineNumSpan.dataset.line);
      const lines = splitEditorLines(editor.value);

      if (lineNum > 0 && lineNum <= lines.length) {
        const pos = getLineStartPositionFromLines(lines, lineNum);
        editor.focus();
        editor.setSelectionRange(pos, pos);
        revealEditorRange(pos, pos);
        updateCurrentLineHighlight(lineNum);
      }
    });
  }

  editor.addEventListener('click', (event) => {
    if (lineHighlight) lineHighlight.style.display = 'none';
    if (!event.shiftKey || !event.altKey) {
      clearBlockSelection();
    }
  });
  editor.addEventListener('input', () => {
    if (lineHighlight) lineHighlight.style.display = 'none';
    clearBlockSelection();
  });
  editor.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
      if (lineHighlight) lineHighlight.style.display = 'none';
    }
  });

  const updateEditor = () => {
    const content = editor.value;
    state.content = content;
    const lineNumbers = renderLineNumberSpans(splitEditorLines(content).length, 'editor-line-num');
    if (lineNumbersEl) {
      lineNumbersEl.innerHTML = lineNumbers;
    }

    syncEditorChrome();
    updateCommandBarMatches(commandBar);
    if (!editor._mindgitApplyingRemote && state.selected) {
      broadcastEditorContent(state.selected, content);
    }
  };

  editor.addEventListener('scroll', () => {
    syncEditorChrome();
    renderBlockSelection(editor, blockSelectionOverlay, blockSelection, LINE_HEIGHT);
    if (lineHighlight && lineHighlight.style.display !== 'none') {
      const cursorLine = getCurrentLine(editor).lineIndex + 1;
      updateCurrentLineHighlight(cursorLine);
    }
  });

  editor.addEventListener('input', () => {
    updateEditor();
    if (editor._mindgitApplyingRemote) {
      resetHistoryState();
      isUndoRedo = false;
      return;
    }
    if (!isUndoRedo && editor.value !== lastValue) {
      recordHistoryState();
    }
    isUndoRedo = false;
  });

  editor.addEventListener('pointerdown', (event) => {
    if (!event.shiftKey || !event.altKey) return;
    event.preventDefault();
    editor.focus();

    const focus = getMouseRowCol(editor, event, LINE_HEIGHT);
    const anchor = blockSelection ? blockSelection.anchor : focus;
    setBlockSelection({ anchor, focus });

    const move = (moveEvent) => {
      setBlockSelection({
        anchor,
        focus: getMouseRowCol(editor, moveEvent, LINE_HEIGHT),
      });
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

  editor.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    const isCtrl = e.ctrlKey && !e.altKey;
    const isModifierOnlyKey = ['control', 'shift', 'alt', 'meta'].includes(key);

    if (blockSelection && isModifierOnlyKey) {
      renderBlockSelection(editor, blockSelectionOverlay, blockSelection, LINE_HEIGHT);
      return;
    }

    if (isCtrl && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (undoStack.length > 1) {
        redoStack.push(undoStack.pop());
        const prevState = undoStack[undoStack.length - 1];
        restoreHistoryState(prevState);
        setMessage('Undo', 'ok');
      }
      return;
    }

    if (isCtrl && ((e.shiftKey && key === 'z') || key === 'y')) {
      e.preventDefault();
      if (redoStack.length > 0) {
        const nextState = redoStack.pop();
        undoStack.push(nextState);
        restoreHistoryState(nextState);
        setMessage('Redo', 'ok');
      }
      return;
    }

    if (blockSelection && isCtrl && key === 'c') {
      e.preventDefault();
      copyBlockSelection(editor, blockSelection);
      setBlockSelection(blockSelection);
      setMessage('Copied block', 'ok');
      return;
    }

    if (blockSelection && isCtrl && key === 'x') {
      e.preventDefault();
      if (cutBlockSelection(editor, blockSelection)) {
        clearBlockSelection();
        commitEditorChange();
        setMessage('Cut block', 'ok');
      }
      return;
    }

    if (blockSelection && isCtrl && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      setBlockSelection(e.shiftKey
        ? {
          anchor: blockSelection.anchor,
          focus: moveBlockFocusWithCtrl(editor, blockSelection.focus, e.key),
        }
        : moveBlockSelection(editor, blockSelection, e.key));
      return;
    }

    if (e.altKey && !e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      state.wordWrap = !state.wordWrap;
      localStorage.setItem('mindgit-wordwrap', state.wordWrap);

      const wrapClass = state.wordWrap ? 'wrap-enabled' : 'wrap-disabled';
      const removeClass = state.wordWrap ? 'wrap-disabled' : 'wrap-enabled';

      editor.classList.remove(removeClass);
      editor.classList.add(wrapClass);

      setMessage(state.wordWrap ? 'Word wrap enabled' : 'Word wrap disabled', 'ok');
      return;
    }

    if (e.shiftKey && e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      if (!blockSelection) {
        const cursor = getCursorPosition(editor);
        blockSelection = { anchor: cursor, focus: cursor };
      }
      setBlockSelection({
        anchor: blockSelection.anchor,
        focus: moveBlockFocus(editor, blockSelection.focus, e.key),
      });
      return;
    }

    if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      clearBlockSelection();
      if (moveSelectedLines(editor, e.key === 'ArrowUp' ? -1 : 1)) {
        commitEditorChange();
      }
      return;
    }

    if (!isModifierOnlyKey && !e.ctrlKey && (!e.shiftKey || !e.altKey)) {
      clearBlockSelection();
    }

    if (isCtrl && key === 's') {
      e.preventDefault();
      saveFile();
    } else if (isCtrl && key === 'enter') {
      e.preventDefault();
      recordSelectionHistoryState();
      insertLineBelow(editor);
      commitEditorChange();
    } else if (!e.ctrlKey && !e.altKey && key === 'enter') {
      e.preventDefault();
      recordSelectionHistoryState();
      insertIndentedNewline(editor);
      commitEditorChange();
    } else if (isCtrl && key === 'f') {
      e.preventDefault();
      showEditorCommandBar(commandBar, 'find');
    } else if (isCtrl && key === 'g') {
      e.preventDefault();
      showEditorCommandBar(commandBar, 'line');
    } else if (isCtrl && key === 'x') {
      if (editor.selectionStart === editor.selectionEnd) {
        e.preventDefault();
        cutLine(editor);
        commitEditorChange();
        setMessage('Cut line', 'ok');
      }
    } else if (isCtrl && key === 'c') {
      if (editor.selectionStart === editor.selectionEnd) {
        e.preventDefault();
        copyLine(editor);
        setMessage('Copied line', 'ok');
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      handleTabIndent(editor, e.shiftKey);
      commitEditorChange();
    }
  });
}

function createEditorCommandBar(editor) {
  const wrapper = editor.closest('.editor-wrapper');
  const bar = document.createElement('div');
  bar.className = 'editor-command-bar';
  bar.hidden = true;
  bar.innerHTML = `
    <input class="editor-command-find" type="text" placeholder="Find" autocomplete="off" />
    <span class="editor-command-count">0/0</span>
    <button class="editor-command-prev" type="button" title="Previous match">Prev</button>
    <button class="editor-command-next" type="button" title="Next match">Next</button>
    <input class="editor-command-replace" type="text" placeholder="Replace" autocomplete="off" />
    <button class="editor-command-replace-one" type="button" title="Replace current match">Replace</button>
    <button class="editor-command-replace-all" type="button" title="Replace all matches">All</button>
    <input class="editor-command-line" type="number" min="1" placeholder="Line" autocomplete="off" />
    <button class="editor-command-go" type="button" title="Go to line">Go</button>
    <button class="editor-command-close" type="button" title="Close">x</button>`;
  wrapper.appendChild(bar);

  const findInput = bar.querySelector('.editor-command-find');
  const replaceInput = bar.querySelector('.editor-command-replace');
  const lineInput = bar.querySelector('.editor-command-line');

  bar._mindgitEditor = editor;
  bar._mindgitFindInput = findInput;
  bar._mindgitReplaceInput = replaceInput;
  bar._mindgitLineInput = lineInput;
  bar._mindgitCount = bar.querySelector('.editor-command-count');

  bar.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (!event.ctrlKey || event.altKey) return;
    if (key === 's') {
      event.preventDefault();
      saveFile();
    } else if (key === 'f') {
      event.preventDefault();
      showEditorCommandBar(bar, 'find');
    } else if (key === 'g') {
      event.preventDefault();
      showEditorCommandBar(bar, 'line');
    }
  });

  findInput.addEventListener('input', () => {
    updateCommandBarMatches(bar);
    selectEditorMatch(bar, 1, true);
  });
  findInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      selectEditorMatch(bar, event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      hideEditorCommandBar(bar);
    }
  });
  replaceInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      replaceCurrentEditorMatch(bar);
    } else if (event.key === 'Escape') {
      hideEditorCommandBar(bar);
    }
  });
  lineInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      goToEditorLineFromBar(bar);
    } else if (event.key === 'Escape') {
      hideEditorCommandBar(bar);
    }
  });

  bar.querySelector('.editor-command-prev').addEventListener('click', () => selectEditorMatch(bar, -1));
  bar.querySelector('.editor-command-next').addEventListener('click', () => selectEditorMatch(bar, 1));
  bar.querySelector('.editor-command-replace-one').addEventListener('click', () => replaceCurrentEditorMatch(bar));
  bar.querySelector('.editor-command-replace-all').addEventListener('click', () => replaceAllEditorMatches(bar));
  bar.querySelector('.editor-command-go').addEventListener('click', () => goToEditorLineFromBar(bar));
  bar.querySelector('.editor-command-close').addEventListener('click', () => hideEditorCommandBar(bar));
  return bar;
}

function showEditorCommandBar(bar, mode) {
  bar.hidden = false;
  updateCommandBarMatches(bar);
  const target = mode === 'line' ? bar._mindgitLineInput : bar._mindgitFindInput;
  target.focus();
  target.select();
}

function hideEditorCommandBar(bar) {
  bar.hidden = true;
  bar._mindgitEditor.focus();
}

function normalizedFindText(value) {
  return value.toLocaleLowerCase();
}

function editorMatches(editor, query) {
  if (!query) return [];
  const text = normalizedFindText(editor.value);
  const needle = normalizedFindText(query);
  const matches = [];
  let index = text.indexOf(needle);
  while (index !== -1) {
    matches.push({ start: index, end: index + query.length });
    index = text.indexOf(needle, index + Math.max(1, query.length));
  }
  return matches;
}

function currentEditorMatchIndex(editor, matches) {
  return matches.findIndex((match) => match.start === editor.selectionStart && match.end === editor.selectionEnd);
}

function updateCommandBarMatches(bar) {
  if (bar.hidden) return;
  const editor = bar._mindgitEditor;
  const query = bar._mindgitFindInput.value;
  const matches = editorMatches(editor, query);
  const current = currentEditorMatchIndex(editor, matches);
  bar._mindgitCount.textContent = matches.length ? `${Math.max(1, current + 1)}/${matches.length}` : '0/0';
}

function selectEditorMatch(bar, direction, fromStart = false) {
  const editor = bar._mindgitEditor;
  const query = bar._mindgitFindInput.value;
  const matches = editorMatches(editor, query);
  if (!matches.length) {
    updateCommandBarMatches(bar);
    return false;
  }

  const current = currentEditorMatchIndex(editor, matches);
  let nextIndex;
  if (current !== -1 && !fromStart) {
    nextIndex = (current + direction + matches.length) % matches.length;
  } else {
    const cursor = direction < 0 ? editor.selectionStart - 1 : editor.selectionEnd;
    if (direction < 0) {
      nextIndex = -1;
      for (let i = matches.length - 1; i >= 0; i--) {
        if (matches[i].start <= cursor) {
          nextIndex = i;
          break;
        }
      }
    } else {
      nextIndex = matches.findIndex((match) => match.start >= cursor);
    }
    if (nextIndex === -1) nextIndex = direction < 0 ? matches.length - 1 : 0;
  }

  const match = matches[nextIndex];
  editor.focus();
  editor.setSelectionRange(match.start, match.end);
  centerEditorSelection(editor, match.start, match.end);
  updateCommandBarMatches(bar);
  return true;
}

function replaceCurrentEditorMatch(bar) {
  const editor = bar._mindgitEditor;
  const query = bar._mindgitFindInput.value;
  if (!query) return;

  const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd);
  if (normalizedFindText(selected) !== normalizedFindText(query)) {
    if (!selectEditorMatch(bar, 1)) return;
  }

  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const replacement = bar._mindgitReplaceInput.value;
  editor.value = editor.value.slice(0, start) + replacement + editor.value.slice(end);
  editor.setSelectionRange(start, start + replacement.length);
  editor.dispatchEvent(new Event('input'));
  selectEditorMatch(bar, 1);
}

function replaceAllEditorMatches(bar) {
  const editor = bar._mindgitEditor;
  const query = bar._mindgitFindInput.value;
  if (!query) return;

  const matches = editorMatches(editor, query);
  if (!matches.length) {
    updateCommandBarMatches(bar);
    return;
  }

  const replacement = bar._mindgitReplaceInput.value;
  let nextValue = '';
  let cursor = 0;
  for (const match of matches) {
    nextValue += editor.value.slice(cursor, match.start) + replacement;
    cursor = match.end;
  }
  nextValue += editor.value.slice(cursor);
  editor.value = nextValue;
  editor.setSelectionRange(0, 0);
  editor.dispatchEvent(new Event('input'));
  updateCommandBarMatches(bar);
  setMessage(`Replaced ${matches.length} matches`, 'ok');
}

function goToEditorLineFromBar(bar) {
  const editor = bar._mindgitEditor;
  const lineNum = parseInt(bar._mindgitLineInput.value, 10);
  if (!Number.isInteger(lineNum)) return;
  goToEditorLine(editor, lineNum);
}

function goToEditorLine(editor, lineNum) {
  const lines = splitEditorLines(editor.value);
  const target = Math.max(1, Math.min(lineNum, lines.length));
  const pos = getLineStartPositionFromLines(lines, target);
  editor.focus();
  editor.setSelectionRange(pos, pos);
  centerEditorSelection(editor, pos, pos, 20);
}

function lineIndexAtPosition(lines, position) {
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const end = offset + lines[i].length;
    if (position <= end || i === lines.length - 1) return i;
    offset = end + 1;
  }
  return lines.length - 1;
}

function selectedLineRange(editor) {
  const lines = splitEditorLines(editor.value);
  const startLine = lineIndexAtPosition(lines, editor.selectionStart);
  let selectionEnd = editor.selectionEnd;
  if (selectionEnd > editor.selectionStart && editor.value[selectionEnd - 1] === '\n') {
    selectionEnd--;
  }
  const endLine = lineIndexAtPosition(lines, selectionEnd);
  return { lines, startLine, endLine };
}

function lineStartOffset(lines, lineIndex) {
  return getLineStartPositionFromLines(lines, lineIndex + 1);
}

function moveSelectedLines(editor, direction) {
  const hadSelection = editor.selectionStart !== editor.selectionEnd;
  const { lines, startLine, endLine } = selectedLineRange(editor);
  if (direction < 0 && startLine === 0) return false;
  if (direction > 0 && endLine === lines.length - 1) return false;

  const cursorCol = editor.selectionStart - lineStartOffset(lines, startLine);
  const selected = lines.splice(startLine, endLine - startLine + 1);
  const insertAt = direction < 0 ? startLine - 1 : startLine + 1;
  lines.splice(insertAt, 0, ...selected);
  editor.value = lines.join('\n');

  const nextStartLine = startLine + direction;
  const nextEndLine = endLine + direction;
  if (hadSelection) {
    const nextStart = lineStartOffset(lines, nextStartLine);
    const nextEnd = lineStartOffset(lines, nextEndLine) + lines[nextEndLine].length;
    editor.setSelectionRange(nextStart, nextEnd);
  } else {
    const nextCursor = lineStartOffset(lines, nextStartLine) + Math.min(cursorCol, lines[nextStartLine].length);
    editor.setSelectionRange(nextCursor, nextCursor);
  }
  editor.scrollTop += direction * 20;
  return true;
}

function getCursorPosition(editor) {
  const text = editor.value;
  const pos = editor.selectionStart;
  const lines = splitEditorLines(text.substring(0, pos));
  const row = lines.length - 1;
  const col = lines[lines.length - 1].length;
  return { row, col, pos };
}

function handleTabIndent(editor, isShiftTab) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const text = editor.value;
  const lines = splitEditorLines(text);

  let startLine = 0;
  let endLine = 0;
  let pos = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineEnd = pos + lines[i].length;
    if (pos <= start && start <= lineEnd) startLine = i;
    if (pos <= end && end <= lineEnd) endLine = i;
    pos = lineEnd + 1;
  }

  if (start === end || startLine === endLine) {
    if (isShiftTab) {
      const lineStart = lines.slice(0, startLine).join('\n').length + (startLine > 0 ? 1 : 0);
      const lineText = lines[startLine];

      if (lineText.startsWith('  ')) {
        lines[startLine] = lineText.substring(2);
        editor.value = lines.join('\n');
        const newPos = Math.max(lineStart, start - 2);
        editor.setSelectionRange(newPos, newPos);
      } else if (lineText.startsWith('\t')) {
        lines[startLine] = lineText.substring(1);
        editor.value = lines.join('\n');
        const newPos = Math.max(lineStart, start - 1);
        editor.setSelectionRange(newPos, newPos);
      }
    } else {
      editor.value = text.substring(0, start) + '  ' + text.substring(end);
      editor.setSelectionRange(start + 2, start + 2);
    }
    return;
  }

  let newStart = start;
  let newEnd = end;

  for (let i = startLine; i <= endLine; i++) {
    if (isShiftTab) {
      if (lines[i].startsWith('  ')) {
        lines[i] = lines[i].substring(2);
        if (i === startLine) newStart = Math.max(0, newStart - 2);
        newEnd -= 2;
      } else if (lines[i].startsWith('\t')) {
        lines[i] = lines[i].substring(1);
        if (i === startLine) newStart = Math.max(0, newStart - 1);
        newEnd -= 1;
      }
    } else {
      lines[i] = '  ' + lines[i];
      if (i === startLine) newStart += 2;
      newEnd += 2;
    }
  }

  editor.value = lines.join('\n');
  editor.setSelectionRange(newStart, newEnd);
}

function getPositionFromRowCol(editor, row, col) {
  const lines = splitEditorLines(editor.value);
  if (row < 0) row = 0;
  if (row >= lines.length) row = lines.length - 1;
  const line = lines[row];
  if (col < 0) col = 0;
  if (col > line.length) col = line.length;
  return getLineStartPositionFromLines(lines, row + 1) + col;
}

function createBlockSelectionOverlay(editor) {
  const overlay = document.createElement('div');
  overlay.className = 'editor-block-selection';
  editor.parentElement.appendChild(overlay);
  return overlay;
}

function getEditorCharWidth(editor) {
  if (editor._mindgitCharWidth) return editor._mindgitCharWidth;

  const probe = document.createElement('span');
  const style = getComputedStyle(editor);
  probe.textContent = 'M';
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.whiteSpace = 'pre';
  probe.style.font = style.font;
  probe.style.letterSpacing = style.letterSpacing;
  document.body.appendChild(probe);

  editor._mindgitCharWidth = probe.getBoundingClientRect().width || 8;
  probe.remove();
  return editor._mindgitCharWidth;
}

function findLineAndColumnAtPosition(lines, position) {
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const end = offset + line.length;
    if (position <= end || i === lines.length - 1) {
      return { lineIndex: i, column: position - offset };
    }
    offset = end + 1;
  }
  return { lineIndex: Math.max(0, lines.length - 1), column: 0 };
}

function centerEditorSelection(editor, start, end = start, lineHeight = 20) {
  const lines = splitEditorLines(editor.value);
  const startPos = findLineAndColumnAtPosition(lines, start);
  const endPos = findLineAndColumnAtPosition(lines, end);
  const focusLine = startPos.lineIndex;
  const focusColumn = startPos.column;
  const selectionColumns = endPos.lineIndex === startPos.lineIndex
    ? Math.max(1, endPos.column - startPos.column)
    : 1;

  const targetTop = (focusLine * lineHeight) - Math.max(0, (editor.clientHeight - lineHeight) / 2);
  editor.scrollTop = Math.max(0, targetTop);

  if (editor.classList.contains('wrap-enabled')) return;

  const style = getComputedStyle(editor);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const charWidth = getEditorCharWidth(editor);
  const focusWidth = Math.max(charWidth, selectionColumns * charWidth);
  const targetLeft = paddingLeft + (focusColumn * charWidth) - Math.max(0, (editor.clientWidth - focusWidth) / 2);
  editor.scrollLeft = Math.max(0, targetLeft);
}

function getMouseRowCol(editor, event, lineHeight) {
  const rect = editor.getBoundingClientRect();
  const style = getComputedStyle(editor);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const charWidth = getEditorCharWidth(editor);
  const lines = splitEditorLines(editor.value);

  const contentX = event.clientX - rect.left + editor.scrollLeft - paddingLeft;
  const contentY = event.clientY - rect.top + editor.scrollTop - paddingTop;
  const row = Math.max(0, Math.min(lines.length - 1, Math.floor(contentY / lineHeight)));
  const col = Math.max(0, Math.round(contentX / charWidth));

  return { row, col };
}

function moveBlockFocus(editor, focus, key) {
  const lines = splitEditorLines(editor.value);
  const next = { row: focus.row, col: focus.col };

  if (key === 'ArrowLeft') next.col = Math.max(0, next.col - 1);
  if (key === 'ArrowRight') next.col += 1;
  if (key === 'ArrowUp') next.row = Math.max(0, next.row - 1);
  if (key === 'ArrowDown') next.row = Math.min(lines.length - 1, next.row + 1);

  return next;
}

function moveBlockSelection(editor, selection, key) {
  const lines = splitEditorLines(editor.value);
  const { startRow, endRow, startCol } = getBlockBounds(selection);
  let rowDelta = 0;
  let colDelta = 0;

  if (key === 'ArrowUp' && startRow > 0) rowDelta = -1;
  if (key === 'ArrowDown' && endRow < lines.length - 1) rowDelta = 1;
  if (key === 'ArrowLeft' && startCol > 0) colDelta = -1;
  if (key === 'ArrowRight') colDelta = 1;

  return {
    anchor: {
      row: selection.anchor.row + rowDelta,
      col: Math.max(0, selection.anchor.col + colDelta),
    },
    focus: {
      row: selection.focus.row + rowDelta,
      col: Math.max(0, selection.focus.col + colDelta),
    },
  };
}

function moveBlockFocusWithCtrl(editor, focus, key) {
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    return moveBlockFocus(editor, focus, key);
  }

  const lines = splitEditorLines(editor.value);
  const line = lines[focus.row] || '';
  return {
    row: focus.row,
    col: key === 'ArrowLeft'
      ? getPreviousWordBoundary(line, focus.col)
      : getNextWordBoundary(line, focus.col),
  };
}

function isWordChar(char) {
  return /[A-Za-z0-9_$]/.test(char);
}

function getPreviousWordBoundary(line, col) {
  let index = Math.min(Math.max(0, col), line.length);
  if (index === 0) return 0;

  while (index > 0 && /\s/.test(line[index - 1])) index--;
  if (index > 0 && isWordChar(line[index - 1])) {
    while (index > 0 && isWordChar(line[index - 1])) index--;
    return index;
  }

  return Math.max(0, index - 1);
}

function getNextWordBoundary(line, col) {
  let index = Math.min(Math.max(0, col), line.length);
  if (index >= line.length) return line.length;

  while (index < line.length && /\s/.test(line[index])) index++;
  if (index < line.length && isWordChar(line[index])) {
    while (index < line.length && isWordChar(line[index])) index++;
    return index;
  }

  return Math.min(line.length, index + 1);
}

function getBlockBounds(selection) {
  const startRow = Math.min(selection.anchor.row, selection.focus.row);
  const endRow = Math.max(selection.anchor.row, selection.focus.row);
  const startCol = Math.min(selection.anchor.col, selection.focus.col);
  const endCol = Math.max(selection.anchor.col, selection.focus.col);
  return { startRow, endRow, startCol, endCol };
}

function renderBlockSelection(editor, overlay, selection, lineHeight) {
  if (!overlay) return;
  overlay.innerHTML = '';
  if (!selection) return;

  const { startRow, endRow, startCol, endCol } = getBlockBounds(selection);
  const style = getComputedStyle(editor);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const charWidth = getEditorCharWidth(editor);
  const width = Math.max(2, (endCol - startCol) * charWidth);
  const left = paddingLeft + (startCol * charWidth) - editor.scrollLeft;

  for (let row = startRow; row <= endRow; row++) {
    const rect = document.createElement('div');
    rect.className = 'editor-block-selection-rect';
    rect.style.left = `${left}px`;
    rect.style.top = `${paddingTop + (row * lineHeight) - editor.scrollTop}px`;
    rect.style.width = `${width}px`;
    rect.style.height = `${lineHeight}px`;
    overlay.appendChild(rect);
  }
}

function getBlockText(editor, selection) {
  const lines = splitEditorLines(editor.value);
  const { startRow, endRow, startCol, endCol } = getBlockBounds(selection);
  const selected = [];

  for (let row = startRow; row <= endRow; row++) {
    const line = lines[row] || '';
    const from = Math.min(startCol, line.length);
    const to = Math.min(endCol, line.length);
    selected.push(line.slice(from, to));
  }

  return selected.join('\n');
}

function writeClipboard(text) {
  const restoreElement = document.activeElement;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch((error) => {
      console.warn('Failed to write clipboard:', error);
      fallbackWriteClipboard(text, restoreElement);
    });
    return;
  }

  fallbackWriteClipboard(text, restoreElement);
}

function fallbackWriteClipboard(text, restoreElement) {
  const restoreSelection = restoreElement && typeof restoreElement.selectionStart === 'number'
    ? { start: restoreElement.selectionStart, end: restoreElement.selectionEnd }
    : null;
  const helper = document.createElement('textarea');
  helper.value = text;
  helper.setAttribute('readonly', '');
  helper.style.position = 'fixed';
  helper.style.left = '-9999px';
  helper.style.top = '0';
  document.body.appendChild(helper);
  helper.select();
  try {
    document.execCommand('copy');
  } catch (error) {
    console.warn('Failed to copy clipboard:', error);
  } finally {
    helper.remove();
    if (restoreElement && typeof restoreElement.focus === 'function') {
      restoreElement.focus({ preventScroll: true });
      if (restoreSelection && typeof restoreElement.setSelectionRange === 'function') {
        restoreElement.setSelectionRange(restoreSelection.start, restoreSelection.end);
      }
    }
  }
}

function copyBlockSelection(editor, selection) {
  writeClipboard(getBlockText(editor, selection));
}

function cutBlockSelection(editor, selection) {
  const lines = splitEditorLines(editor.value);
  const { startRow, endRow, startCol, endCol } = getBlockBounds(selection);
  const text = getBlockText(editor, selection);
  let changed = false;

  if (startCol === endCol) return false;

  for (let row = startRow; row <= endRow; row++) {
    const line = lines[row] || '';
    const from = Math.min(startCol, line.length);
    const to = Math.min(endCol, line.length);
    if (to <= from) continue;
    lines[row] = line.slice(0, from) + line.slice(to);
    changed = true;
  }

  if (!changed) return false;
  writeClipboard(text);
  editor.value = lines.join('\n');
  const cursor = getPositionFromRowCol(editor, startRow, startCol);
  editor.setSelectionRange(cursor, cursor);
  return true;
}

function getCurrentLine(editor) {
  const pos = editor.selectionStart;
  const text = editor.value;
  const lines = splitEditorLines(text);

  let currentPos = 0;
  let lineIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineLength = lines[i].length + 1;
    if (currentPos + lineLength > pos || i === lines.length - 1) {
      lineIndex = i;
      break;
    }
    currentPos += lineLength;
  }

  const line = lines[lineIndex] || '';
  return { lineIndex, line, lines, lineStartPos: currentPos };
}

function leadingIndent(line) {
  return (line.match(/^[\t ]*/) || [''])[0];
}

function insertIndentedNewline(editor) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const text = editor.value;
  const { line } = getCurrentLine(editor);
  const indent = leadingIndent(line);
  const insertText = `\n${indent}`;
  const cursor = start + insertText.length;

  editor.value = text.slice(0, start) + insertText + text.slice(end);
  editor.setSelectionRange(cursor, cursor);
}

function insertLineBelow(editor) {
  const text = editor.value;
  const pos = editor.selectionEnd;
  const lineEnd = text.indexOf('\n', pos);
  const insertAt = lineEnd === -1 ? text.length : lineEnd;
  const { line } = getCurrentLine(editor);
  const indent = leadingIndent(line);
  const insertText = `\n${indent}`;
  const cursor = insertAt + insertText.length;

  editor.value = text.slice(0, insertAt) + insertText + text.slice(insertAt);
  editor.setSelectionRange(cursor, cursor);
}

function cutLine(editor) {
  const text = editor.value;
  const pos = editor.selectionStart;
  const lineStart = text.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
  const nextBreak = text.indexOf('\n', pos);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  const copied = text.slice(lineStart, lineEnd) + '\n';
  let deleteStart = lineStart;
  let deleteEnd = lineEnd;

  if (nextBreak !== -1) {
    deleteEnd = nextBreak + 1;
  } else if (lineStart > 0) {
    deleteStart = lineStart - 1;
  }

  writeClipboard(copied);
  editor.value = text.slice(0, deleteStart) + text.slice(deleteEnd);
  const cursor = Math.min(deleteStart, editor.value.length);
  editor.setSelectionRange(cursor, cursor);
}

function copyLine(editor) {
  const { line } = getCurrentLine(editor);
  writeClipboard(line + '\n');
}
