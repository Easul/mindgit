function setupEditorShortcuts(editor) {
  const LINE_HEIGHT = 20;
  const EDITOR_PADDING_TOP = 16;
  const lineNumbersEl = $('editor-line-numbers');
  const lineGutterEl = $('editor-line-gutter');
  const lineHighlight = $('editor-line-highlight');
  const blockSelectionOverlay = createBlockSelectionOverlay(editor);

  let undoStack = [{ value: editor.value, cursor: 0 }];
  let redoStack = [];
  let lastValue = editor.value;
  let isUndoRedo = false;
  let blockSelection = null;

  function syncEditorChrome() {
    if (lineNumbersEl) {
      lineNumbersEl.style.transform = `translateY(${-editor.scrollTop}px)`;
    }
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
      cursor: editor.selectionStart
    });
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
    lastValue = editor.value;
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

        const lineTop = (lineNum - 1) * LINE_HEIGHT;
        editor.scrollTop = Math.max(0, lineTop - Math.max(0, (editor.clientHeight - LINE_HEIGHT) / 2));
        syncEditorChrome();
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
      const lineNumberWidth = lineGutterEl ? lineGutterEl.offsetWidth : lineNumbersEl.offsetWidth;
      editor.style.paddingLeft = `${lineNumberWidth + 12}px`;
    }

    syncEditorChrome();
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
    const isModifierOnlyKey = ['control', 'shift', 'alt', 'meta'].includes(key);

    if (blockSelection && isModifierOnlyKey) {
      renderBlockSelection(editor, blockSelectionOverlay, blockSelection, LINE_HEIGHT);
      return;
    }

    if (e.ctrlKey && !e.altKey && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
      e.preventDefault();
      if (undoStack.length > 1) {
        redoStack.push(undoStack.pop());
        const prevState = undoStack[undoStack.length - 1];
        isUndoRedo = true;
        editor.value = prevState.value;
        lastValue = prevState.value;
        updateEditor();
        editor.setSelectionRange(prevState.cursor, prevState.cursor);
        setMessage('Undo', 'ok');
      }
      return;
    }

    if (e.ctrlKey && !e.altKey && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y')) {
      e.preventDefault();
      if (redoStack.length > 0) {
        const nextState = redoStack.pop();
        undoStack.push(nextState);
        isUndoRedo = true;
        editor.value = nextState.value;
        lastValue = nextState.value;
        updateEditor();
        editor.setSelectionRange(nextState.cursor, nextState.cursor);
        setMessage('Redo', 'ok');
      }
      return;
    }

    if (blockSelection && e.ctrlKey && !e.altKey && key === 'c') {
      e.preventDefault();
      copyBlockSelection(editor, blockSelection);
      setBlockSelection(blockSelection);
      setMessage('Copied block', 'ok');
      return;
    }

    if (blockSelection && e.ctrlKey && !e.altKey && key === 'x') {
      e.preventDefault();
      if (cutBlockSelection(editor, blockSelection)) {
        clearBlockSelection();
        updateEditor();
        recordHistoryState();
        setMessage('Cut block', 'ok');
      }
      return;
    }

    if (blockSelection && e.ctrlKey && !e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
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

    if (!isModifierOnlyKey && !e.ctrlKey && (!e.shiftKey || !e.altKey)) {
      clearBlockSelection();
    }

    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      saveFile();
    } else if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      const pos = editor.selectionStart;
      const val = editor.value;
      editor.value = val.substring(0, pos) + '\n' + val.substring(pos);
      editor.selectionStart = editor.selectionEnd = pos + 1;
      updateEditor();
      recordHistoryState();
    } else if (e.ctrlKey && e.key === 'f') {
      e.preventDefault();
      showFindReplace(editor);
    } else if (e.ctrlKey && e.key === 'g') {
      e.preventDefault();
      showGotoLine(editor);
    } else if (e.ctrlKey && key === 'x') {
      if (editor.selectionStart === editor.selectionEnd) {
        e.preventDefault();
        cutLine(editor);
        updateEditor();
        recordHistoryState();
        setMessage('Cut line', 'ok');
      }
    } else if (e.ctrlKey && key === 'c') {
      if (editor.selectionStart === editor.selectionEnd) {
        e.preventDefault();
        copyLine(editor);
        setMessage('Copied line', 'ok');
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      handleTabIndent(editor, e.shiftKey);
      updateEditor();
      recordHistoryState();
    }
  });
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

function showFindReplace(editor) {
  const query = prompt('Find:');
  if (!query) return;
  const replace = prompt('Replace with (leave empty to skip replace):');
  if (replace !== null && replace !== '') {
    editor.value = editor.value.replaceAll(query, replace);
    editor.dispatchEvent(new Event('input'));
  } else {
    const index = editor.value.indexOf(query);
    if (index !== -1) {
      editor.focus();
      editor.selectionStart = index;
      editor.selectionEnd = index + query.length;
    } else {
      alert('Not found');
    }
  }
}

function showGotoLine(editor) {
  const line = prompt('Go to line:');
  if (!line) return;
  const lineNum = parseInt(line, 10);
  if (isNaN(lineNum)) return;
  const lines = splitEditorLines(editor.value);
  if (lineNum < 1 || lineNum > lines.length) {
    alert(`Line must be between 1 and ${lines.length}`);
    return;
  }
  const pos = getLineStartPositionFromLines(lines, lineNum);
  editor.focus();
  editor.selectionStart = editor.selectionEnd = pos;
  editor.scrollTop = editor.scrollHeight * ((lineNum - 1) / lines.length);
}
