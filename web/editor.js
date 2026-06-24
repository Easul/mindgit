function setupEditorShortcuts(editor) {
  const LINE_HEIGHT = 20;
  const EDITOR_PADDING_TOP = 16;
  const lineNumbersEl = $('editor-line-numbers');
  const lineGutterEl = $('editor-line-gutter');
  const lineHighlight = $('editor-line-highlight');

  let undoStack = [{ value: editor.value, cursor: 0 }];
  let redoStack = [];
  let lastValue = editor.value;
  let isUndoRedo = false;

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

  editor.addEventListener('click', () => {
    if (lineHighlight) lineHighlight.style.display = 'none';
  });
  editor.addEventListener('input', () => {
    if (lineHighlight) lineHighlight.style.display = 'none';
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

  let columnSelectStart = null;

  editor.addEventListener('keydown', (e) => {
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
      if (!columnSelectStart) {
        columnSelectStart = getCursorPosition(editor);
      }
      handleColumnSelection(editor, columnSelectStart, e.key);
      return;
    }

    if (!e.shiftKey || !e.altKey) {
      columnSelectStart = null;
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
    } else if (e.ctrlKey && e.key === 'x') {
      if (editor.selectionStart === editor.selectionEnd) {
        e.preventDefault();
        cutLine(editor);
        updateEditor();
      }
    } else if (e.ctrlKey && e.key === 'c') {
      if (editor.selectionStart === editor.selectionEnd) {
        e.preventDefault();
        copyLine(editor);
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
  if (col > line.length) col = line.length;
  return getLineStartPositionFromLines(lines, row + 1) + col;
}

function handleColumnSelection(editor, start, key) {
  const current = getCursorPosition(editor);
  let targetRow = current.row;
  let targetCol = current.col;

  switch (key) {
    case 'ArrowLeft':
      targetCol = Math.max(0, current.col - 1);
      break;
    case 'ArrowRight':
      targetCol = current.col + 1;
      break;
    case 'ArrowUp':
      targetRow = Math.max(0, current.row - 1);
      break;
    case 'ArrowDown':
      targetRow = current.row + 1;
      break;
  }

  const lines = splitEditorLines(editor.value);
  const minRow = Math.min(start.row, targetRow);
  const minCol = Math.min(start.col, targetCol);

  const selStart = getPositionFromRowCol(editor, minRow, minCol);
  const selEnd = getPositionFromRowCol(editor, targetRow, targetCol);

  if (selStart <= selEnd) {
    editor.selectionStart = selStart;
    editor.selectionEnd = selEnd;
  } else {
    editor.selectionStart = selEnd;
    editor.selectionEnd = selStart;
  }
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
  const { lineIndex, line, lines } = getCurrentLine(editor);
  navigator.clipboard.writeText(line + '\n').then(() => {
    lines.splice(lineIndex, 1);
    editor.value = lines.join('\n');
    editor.dispatchEvent(new Event('input'));

    const newLineIndex = Math.min(lineIndex, lines.length - 1);
    let pos = 0;
    for (let i = 0; i < newLineIndex; i++) {
      pos += lines[i].length + 1;
    }
    editor.selectionStart = editor.selectionEnd = pos;
  }).catch(err => console.error('Failed to cut line:', err));
}

function copyLine(editor) {
  const { line } = getCurrentLine(editor);
  navigator.clipboard.writeText(line + '\n').catch(err => console.error('Failed to copy line:', err));
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
