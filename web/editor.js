function setupEditorShortcuts(editor) {
  const LINE_HEIGHT = 20;
  const EDITOR_PADDING_TOP = 16;
  const lineNumbersEl = $('editor-line-numbers');
  const lineGutterEl = $('editor-line-gutter');
  const lineHighlight = $('editor-line-highlight');
  const highlightEl = $('editor-highlight');
  const selectionMatchOverlay = createSelectionMatchOverlay(editor);
  const blockSelectionOverlay = createBlockSelectionOverlay(editor);
  const linkHintOverlay = createEditorLinkHintOverlay(editor);
  const findBar = createEditorFindBar(editor);
  const lineBar = createEditorLineBar(editor);
  const linkHintAbort = new AbortController();
  const listenerOptions = { signal: linkHintAbort.signal };

  let blockSelection = null;
  let undoStack = [createHistoryState()];
  let redoStack = [];
  let lastValue = editor.value;
  let pendingHistoryInput = null;
  let historyGroup = null;
  const historyBudget = 8 * 1024 * 1024;
  let isUndoRedo = false;
  let linkModifierActive = false;
  let lastHoverPoint = null;
  let hoveredLinkTarget = null;
  let lastRenderedLineCount = lineNumbersEl?.childElementCount || 0;
  let lastLargeDocument = editor.classList.contains('large-document');
  let editorRenderFrame = 0;
  let editorChromeFrame = 0;
  let selectionHighlightFrame = 0;
  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
      clearEditorWrapLayoutCache(editor);
      syncEditorLineNumberLayout(editor, lineNumbersEl, LINE_HEIGHT);
      if (lineHighlight && lineHighlight.style.display !== 'none') {
        const cursorLine = getCurrentLine(editor).lineIndex + 1;
        updateCurrentLineHighlight(cursorLine);
      }
      renderEditorFindHighlights(findBar);
    })
    : null;

  resizeObserver?.observe(editor);
  window.addEventListener('resize', () => {
    requestAnimationFrame(() => {
      clearEditorWrapLayoutCache(editor);
      syncEditorLineNumberLayout(editor, lineNumbersEl, LINE_HEIGHT);
      renderEditorFindHighlights(findBar);
    });
  }, listenerOptions);

  function hideEditorLinkHint() {
    hoveredLinkTarget = null;
    linkHintOverlay.hidden = true;
    editor.style.cursor = 'text';
  }

  function showEditorLinkHint(target) {
    hoveredLinkTarget = target;
    if (editor.classList.contains('wrap-enabled')) {
      linkHintOverlay.hidden = true;
      editor.style.cursor = 'pointer';
      return;
    }

    const lines = splitEditorLines(editor.value);
    const start = findLineAndColumnAtPosition(lines, target.start);
    const end = findLineAndColumnAtPosition(lines, target.end);
    if (start.lineIndex !== end.lineIndex) {
      linkHintOverlay.hidden = true;
      editor.style.cursor = 'pointer';
      return;
    }

    const style = getComputedStyle(editor);
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const charWidth = getEditorCharWidth(editor);
    const line = lines[start.lineIndex] || '';
    const left = paddingLeft + getEditorColumnOffset(editor, line, start.column) - editor.scrollLeft;
    const top = paddingTop + (start.lineIndex * LINE_HEIGHT) - editor.scrollTop;
    const width = Math.max(charWidth, getEditorColumnsWidth(editor, line, start.column, end.column));

    linkHintOverlay.style.left = `${left}px`;
    linkHintOverlay.style.top = `${top}px`;
    linkHintOverlay.style.width = `${width}px`;
    linkHintOverlay.style.height = `${LINE_HEIGHT}px`;
    linkHintOverlay.hidden = false;
    editor.style.cursor = 'pointer';
  }

  function linkTargetAtPoint(point) {
    if (!point) return null;
    const rowCol = getMouseRowCol(editor, point, LINE_HEIGHT);
    const position = getPositionFromRowCol(editor, rowCol.row, rowCol.col);
    return urlMatchAtPosition(editor.value, position);
  }

  function refreshEditorLinkHint() {
    if (editor.classList.contains('large-document') || !linkModifierActive || !lastHoverPoint) {
      hideEditorLinkHint();
      return;
    }
    const target = linkTargetAtPoint(lastHoverPoint);
    if (!target) {
      hideEditorLinkHint();
      return;
    }
    showEditorLinkHint(target);
  }

  function syncEditorChrome() {
    if (lineNumbersEl) {
      lineNumbersEl.style.transform = `translateY(${-editor.scrollTop}px)`;
    }
    syncEditorHighlightScroll(editor, highlightEl);
    refreshEditorLinkHint();
  }

  function revealEditorRange(start, end = start) {
    centerEditorSelection(editor, start, end, LINE_HEIGHT);
    syncEditorChrome();
  }

  function updateCurrentLineHighlight(lineNum) {
    if (!lineHighlight) return;
    const wrapLayout = getEditorWrappedLineLayout(editor, LINE_HEIGHT);
    const index = Math.max(0, lineNum - 1);
    const top = EDITOR_PADDING_TOP
      + (wrapLayout ? (wrapLayout.tops[index] || 0) : index * LINE_HEIGHT)
      - editor.scrollTop;
    const height = wrapLayout ? (wrapLayout.heights[index] || LINE_HEIGHT) : LINE_HEIGHT;
    lineHighlight.style.top = `${top}px`;
    lineHighlight.style.height = `${height}px`;
    lineHighlight.style.display = 'block';
  }

  function createHistoryState() {
    return {
      value: editor.value,
      start: editor.selectionStart,
      end: editor.selectionEnd,
      blockSelection: cloneBlockSelection(blockSelection),
    };
  }

  function historyGroupKind(inputType) {
    if (['insertText', 'insertCompositionText', 'insertFromComposition'].includes(inputType)) return 'typing';
    if (inputType === 'deleteContentBackward') return 'backspace';
    if (inputType === 'deleteContentForward') return 'delete';
    return '';
  }

  function recordHistoryState(input = null) {
    if (editor.value === lastValue) return;
    const nextState = createHistoryState();
    const kind = historyGroupKind(input?.inputType);
    const contiguous = kind === 'typing'
      ? input.start === historyGroup?.end && input.end === historyGroup?.end
      : input.start === historyGroup?.start && input.end === historyGroup?.end;
    const canMerge = Boolean(
      kind
      && historyGroup?.kind === kind
      && input.time - historyGroup.time < 1500
      && contiguous
      && undoStack.length > 1
    );

    if (canMerge) {
      undoStack[undoStack.length - 1] = nextState;
    } else {
      undoStack.push(nextState);
    }
    trimHistory();
    redoStack = [];
    lastValue = editor.value;
    historyGroup = kind
      ? {
        kind,
        time: input.time,
        start: nextState.start,
        end: nextState.end,
      }
      : null;
  }

  function trimHistory() {
    let bytes = undoStack.reduce((total, item) => total + item.value.length * 2, 0);
    while (undoStack.length > 2 && bytes > historyBudget) {
      bytes -= undoStack[0].value.length * 2;
      undoStack.shift();
    }
    if (undoStack.length > 100) undoStack.shift();
  }

  function resetHistoryState() {
    undoStack = [createHistoryState()];
    redoStack = [];
    lastValue = editor.value;
    pendingHistoryInput = null;
    historyGroup = null;
  }

  function recordSelectionHistoryState() {
    const current = undoStack[undoStack.length - 1];
    if (
      current &&
      current.value === editor.value &&
      current.start === editor.selectionStart &&
      current.end === editor.selectionEnd &&
      blockSelectionsEqual(current.blockSelection, blockSelection)
    ) {
      return;
    }

    undoStack.push(createHistoryState());
    trimHistory();
    redoStack = [];
    historyGroup = null;
  }

  function restoreHistoryState(historyState) {
    isUndoRedo = true;
    editor.value = historyState.value;
    lastValue = historyState.value;
    updateEditor();
    const start = historyState.start ?? historyState.cursor ?? 0;
    const end = historyState.end ?? start;
    if (historyState.blockSelection) {
      setBlockSelection(historyState.blockSelection);
    } else {
      clearBlockSelection();
      editor.setSelectionRange(start, end);
    }
    isUndoRedo = false;
  }

  function commitEditorChange() {
    updateEditor();
    recordHistoryState(null);
  }

  function clearBlockSelection() {
    blockSelection = null;
    renderBlockSelection(editor, blockSelectionOverlay, blockSelection, LINE_HEIGHT);
  }

  function setBlockSelection(nextSelection) {
    blockSelection = cloneBlockSelection(nextSelection);
    const focusPoint = getBlockSelectionFocusPoint(editor, blockSelection);
    if (!focusPoint) {
      clearBlockSelection();
      return;
    }
    const focusPos = getPositionFromRowCol(editor, focusPoint.row, focusPoint.col);
    editor.setSelectionRange(focusPos, focusPos);
    renderBlockSelection(editor, blockSelectionOverlay, blockSelection, LINE_HEIGHT);
  }

  function dispatchEditorInput(preserveBlockSelection = false) {
    editor._mindgitPreserveBlockSelection = preserveBlockSelection;
    editor.dispatchEvent(new Event('input'));
    editor._mindgitPreserveBlockSelection = false;
  }

  function applyBlockSelectionResult(result) {
    if (!result || result.value === editor.value) return false;
    editor.value = result.value;
    if (result.selection) {
      setBlockSelection(result.selection);
    } else {
      clearBlockSelection();
    }
    dispatchEditorInput(Boolean(result.selection));
    const focusPoint = result.selection ? getBlockSelectionFocusPoint(editor, blockSelection) : null;
    if (focusPoint) {
      const focusPos = getPositionFromRowCol(editor, focusPoint.row, focusPoint.col);
      revealEditorRange(focusPos, focusPos);
    }
    return true;
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

  editor.addEventListener('pointerdown', (event) => {
    if (!hasOpenLinkModifier(event)) return;
    lastHoverPoint = { clientX: event.clientX, clientY: event.clientY };
    const target = linkTargetAtPoint(lastHoverPoint);
    if (!target) return;
    event.preventDefault();
  }, listenerOptions);

  editor.addEventListener('click', (event) => {
    if (hasOpenLinkModifier(event)) {
      lastHoverPoint = { clientX: event.clientX, clientY: event.clientY };
      const target = linkTargetAtPoint(lastHoverPoint);
      if (target) {
        event.preventDefault();
        event.stopPropagation();
        window.open(target.url, '_blank', 'noopener');
        return;
      }
    }
    if (lineHighlight) lineHighlight.style.display = 'none';
    if (!event.shiftKey || !event.altKey) {
      clearBlockSelection();
    }
  }, listenerOptions);
  editor.addEventListener('input', () => {
    if (lineHighlight) lineHighlight.style.display = 'none';
    if (!editor._mindgitPreserveBlockSelection && !editor._mindgitMultiCaretComposition) {
      clearBlockSelection();
    }
    clearEditorMeasurementCache(editor);
    clearEditorWrapLayoutCache(editor);
  });
  editor.addEventListener('compositionstart', () => {
    editor._mindgitComposing = true;
    if (blockSelection && isMultiLineBlockSelection(blockSelection)) {
      recordSelectionHistoryState();
      editor._mindgitMultiCaretComposition = {
        value: editor.value,
        selection: cloneBlockSelection(blockSelection),
      };
    }
  });
  editor.addEventListener('compositionend', () => {
    setTimeout(() => {
      if (!editor.isConnected) return;
      const multiCaretComposition = editor._mindgitMultiCaretComposition;
      editor._mindgitMultiCaretComposition = null;
      if (multiCaretComposition) {
        const replacement = changedTextBetween(multiCaretComposition.value, editor.value);
        editor.value = multiCaretComposition.value;
        lastValue = multiCaretComposition.value;
        setBlockSelection(multiCaretComposition.selection);
        if (replacement !== null) {
          applyBlockSelectionResult(replaceBlockSelectionText(
            editor,
            multiCaretComposition.selection,
            replacement,
          ));
        } else {
          updateEditor();
        }
      }
      editor._mindgitComposing = false;
      editor._mindgitPendingRemoteContent = null;
      if (!editor._mindgitApplyingRemote && state.selected) {
        broadcastEditorContent(state.selected, editor.value);
      }
    }, 0);
  });
  const flushSelectionHighlights = () => {
    selectionHighlightFrame = 0;
    updateFindBarMatches(findBar);
    renderEditorFindHighlights(findBar);
  };
  const updateSelectionHighlights = () => {
    if (selectionHighlightFrame) return;
    selectionHighlightFrame = requestAnimationFrame(flushSelectionHighlights);
  };
  editor.addEventListener('select', updateSelectionHighlights);
  editor.addEventListener('pointerup', updateSelectionHighlights);
  editor.addEventListener('keyup', updateSelectionHighlights);
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === editor) updateSelectionHighlights();
  }, listenerOptions);
  editor.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
      if (lineHighlight) lineHighlight.style.display = 'none';
    }
  });

  const renderEditorUpdate = () => {
    editorRenderFrame = 0;
    const content = editor.value;
    const largeDocument = isLargeTextDocument(content);
    editor.classList.toggle('large-document', largeDocument);
    editor.closest('.editor-wrapper')?.classList.toggle('editor-large-document', largeDocument);
    if (lineNumbersEl) {
      const lineCount = largeDocument ? 0 : countTextLines(content);
      if (largeDocument !== lastLargeDocument || lineCount !== lastRenderedLineCount) {
        lineNumbersEl.innerHTML = largeDocument ? '' : renderLineNumberSpans(lineCount, 'editor-line-num');
        lastLargeDocument = largeDocument;
        lastRenderedLineCount = lineCount;
      }
      if (!largeDocument) syncEditorLineNumberLayout(editor, lineNumbersEl, LINE_HEIGHT);
    }

    syncEditorChrome();
    updateSelectionHighlights();
  };

  const updateEditor = () => {
    const content = editor.value;
    state.content = content;
    if (state.selected && state.mode === 'edit') {
      state.tabDrafts[state.selected] = content;
    }
    if (!editor._mindgitApplyingRemote && !editor._mindgitComposing && state.selected) {
      broadcastEditorContent(state.selected, content);
    }
    if (!editorRenderFrame) editorRenderFrame = requestAnimationFrame(renderEditorUpdate);
  };

  editor.addEventListener('scroll', () => {
    if (editorChromeFrame) return;
    editorChromeFrame = requestAnimationFrame(() => {
      editorChromeFrame = 0;
      syncEditorChrome();
      renderEditorFindHighlights(findBar);
      renderBlockSelection(editor, blockSelectionOverlay, blockSelection, LINE_HEIGHT);
      if (lineHighlight && lineHighlight.style.display !== 'none') {
        const cursorLine = getCurrentLine(editor).lineIndex + 1;
        updateCurrentLineHighlight(cursorLine);
      }
    });
  });

  editor.addEventListener('input', () => {
    updateEditor();
    if (editor._mindgitMultiCaretComposition) return;
    if (editor._mindgitApplyingRemote) {
      resetHistoryState();
      isUndoRedo = false;
      return;
    }
    if (!isUndoRedo && editor.value !== lastValue) {
      recordHistoryState(pendingHistoryInput);
    }
    if (pendingHistoryInput?.inputType === 'insertLineBreak' || pendingHistoryInput?.inputType === 'insertParagraph') {
      revealMobileLineStart(editor);
    }
    pendingHistoryInput = null;
    isUndoRedo = false;
  });

  editor.addEventListener('mousemove', (event) => {
    lastHoverPoint = { clientX: event.clientX, clientY: event.clientY };
    linkModifierActive = hasOpenLinkModifier(event);
    refreshEditorLinkHint();
  }, listenerOptions);

  editor.addEventListener('mouseleave', () => {
    lastHoverPoint = null;
    hideEditorLinkHint();
  }, listenerOptions);

  document.addEventListener('keydown', (event) => {
    linkModifierActive = hasOpenLinkModifier(event);
    refreshEditorLinkHint();
  }, { capture: true, signal: linkHintAbort.signal });

  document.addEventListener('keyup', (event) => {
    linkModifierActive = hasOpenLinkModifier(event);
    refreshEditorLinkHint();
  }, { capture: true, signal: linkHintAbort.signal });

  window.addEventListener('blur', () => {
    linkModifierActive = false;
    hideEditorLinkHint();
  }, listenerOptions);

  editor.dataset.mindgitCleanup = 'true';
  editor._mindgitCleanup = () => {
    cancelAnimationFrame(editorRenderFrame);
    cancelAnimationFrame(editorChromeFrame);
    cancelAnimationFrame(selectionHighlightFrame);
    resizeObserver?.disconnect();
    linkHintAbort.abort();
    hideEditorLinkHint();
    editor._mindgitMeasurementLayer?.root?.remove();
    editor._mindgitMeasurementLayer = null;
    editor._mindgitWrapMeasurementLayer?.root?.remove();
    editor._mindgitWrapMeasurementLayer = null;
    editor._mindgitSelectionMatchOverlay = null;
    clearEditorMeasurementCache(editor);
    clearEditorWrapLayoutCache(editor);
  };

  editor.addEventListener('beforeinput', (event) => {
    pendingHistoryInput = {
      inputType: event.inputType,
      start: editor.selectionStart,
      end: editor.selectionEnd,
      time: performance.now(),
    };
    if (!blockSelection || !isMultiLineBlockSelection(blockSelection) || event.isComposing) return;

    if (
      event.inputType === 'insertText' ||
      event.inputType === 'insertReplacementText' ||
      event.inputType === 'insertCompositionText' ||
      event.inputType === 'insertFromComposition'
    ) {
      if (typeof event.data !== 'string') return;
      event.preventDefault();
      applyBlockSelectionResult(replaceBlockSelectionText(editor, blockSelection, event.data));
      return;
    }

    if (event.inputType === 'insertFromPaste') {
      const pasted = event.dataTransfer?.getData('text/plain') ?? event.data;
      if (typeof pasted !== 'string') return;
      event.preventDefault();
      applyBlockSelectionResult(pasteIntoBlockSelection(editor, blockSelection, pasted));
      return;
    }

    if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') {
      event.preventDefault();
      applyBlockSelectionResult(insertBlockSelectionNewline(editor, blockSelection));
      return;
    }

    if (event.inputType === 'deleteContentBackward') {
      event.preventDefault();
      applyBlockSelectionResult(deleteBlockSelectionContent(editor, blockSelection, 'backward'));
      return;
    }

    if (event.inputType === 'deleteContentForward') {
      event.preventDefault();
      applyBlockSelectionResult(deleteBlockSelectionContent(editor, blockSelection, 'forward'));
    }
  });

  editor.addEventListener('paste', (event) => {
    if (!blockSelection || !isMultiLineBlockSelection(blockSelection)) return;
    const pasted = event.clipboardData?.getData('text/plain');
    if (typeof pasted !== 'string') return;
    event.preventDefault();
    applyBlockSelectionResult(pasteIntoBlockSelection(editor, blockSelection, pasted));
  });

  editor.addEventListener('pointerdown', (event) => {
    historyGroup = null;
    if (!event.shiftKey || !event.altKey) return;
    event.preventDefault();
    editor.focus();

    const focus = getMouseRowCol(editor, event, LINE_HEIGHT);
    const initialSelection = cloneBlockSelection(blockSelection);
    const initialX = event.clientX;
    const initialY = event.clientY;
    let dragging = false;
    setBlockSelection(addBlockSelectionCaret(editor, initialSelection, focus));

    const move = (moveEvent) => {
      if (!dragging && Math.hypot(moveEvent.clientX - initialX, moveEvent.clientY - initialY) < 4) return;
      dragging = true;
      const nextFocus = getMouseRowCol(editor, moveEvent, LINE_HEIGHT);
      setBlockSelection(addBlockSelectionColumn(editor, initialSelection, focus, nextFocus));
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
    const shouldKeepMultiSelection = blockSelection
      && isMultiLineBlockSelection(blockSelection)
      && !e.ctrlKey
      && !e.altKey
      && (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter' || e.key === 'Process' || e.isComposing);

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
      historyGroup = null;
    }

    if (blockSelection && isModifierOnlyKey) {
      renderBlockSelection(editor, blockSelectionOverlay, blockSelection, LINE_HEIGHT);
      return;
    }

    if (isCtrl && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      historyGroup = null;
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
      historyGroup = null;
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

    if (blockSelection && isMultiLineBlockSelection(blockSelection) && e.key === 'Tab') {
      e.preventDefault();
      recordSelectionHistoryState();
      if (applyBlockSelectionResult(indentBlockSelection(editor, blockSelection, e.shiftKey))) {
        setMessage(e.shiftKey ? 'Outdented cursors' : 'Indented cursors', 'ok');
      }
      return;
    }

    if (blockSelection && isMultiLineBlockSelection(blockSelection) && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault();
      recordSelectionHistoryState();
      applyBlockSelectionResult(deleteBlockSelectionContent(
        editor,
        blockSelection,
        e.key === 'Backspace' ? 'backward' : 'forward',
      ));
      return;
    }

    if (blockSelection && isMultiLineBlockSelection(blockSelection) && !e.ctrlKey && !e.altKey && e.key === 'Enter') {
      e.preventDefault();
      recordSelectionHistoryState();
      if (applyBlockSelectionResult(insertBlockSelectionNewline(editor, blockSelection))) {
        commitEditorChange();
      }
      return;
    }

    if (blockSelection && isCtrl && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const nextSelection = e.shiftKey
        ? moveBlockSelectionFocusWithCtrl(editor, blockSelection, e.key)
        : ['ArrowLeft', 'ArrowRight'].includes(e.key)
          ? moveBlockCaretsWithCtrl(editor, blockSelection, e.key)
          : moveBlockSelection(editor, blockSelection, e.key);
      if (nextSelection) {
        setBlockSelection(nextSelection);
      }
      return;
    }

    if (e.altKey && !e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      setEditorWordWrap(!state.wordWrap);
      return;
    }

    if (e.shiftKey && e.altKey && e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      recordSelectionHistoryState();
      const direction = e.key === 'ArrowUp' ? -1 : 1;
      if (duplicateSelectedLines(editor, direction, blockSelection)) {
        if (blockSelection) {
          const copiedSelection = shiftBlockSelectionRows(blockSelection, direction < 0 ? 0 : getBlockSelectionLineCount(editor, blockSelection));
          setBlockSelection(copiedSelection);
        } else {
          clearBlockSelection();
        }
        commitEditorChange();
      }
      return;
    }

    if (e.shiftKey && e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      if (!blockSelection) {
        const cursor = getCursorPosition(editor);
        blockSelection = createColumnBlockSelection(cursor, cursor);
      }
      if (isMultiLineBlockSelection(blockSelection) && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const nextSelection = moveBlockSelectionToLineBoundary(editor, blockSelection, e.key);
        if (nextSelection) setBlockSelection(nextSelection);
        return;
      }
      const anchor = blockSelection.anchor || getBlockSelectionFocusPoint(editor, blockSelection);
      const focus = blockSelection.focus || getBlockSelectionFocusPoint(editor, blockSelection);
      if (!anchor || !focus) return;
      setBlockSelection(createColumnBlockSelection(anchor, moveBlockFocus(editor, focus, e.key)));
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

    if (!isModifierOnlyKey && !e.ctrlKey && (!e.shiftKey || !e.altKey) && !shouldKeepMultiSelection) {
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
      revealMobileLineStart(editor);
    } else if (isCtrl && key === 'f') {
      e.preventDefault();
      showEditorFindBar(findBar);
    } else if (isCtrl && key === 'g') {
      e.preventDefault();
      showEditorLineBar(lineBar);
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

function createEditorFindBar(editor) {
  const wrapper = editor.closest('.editor-wrapper');
  const bar = document.createElement('div');
  bar.className = 'editor-command-bar editor-command-bar-find';
  bar.dataset.regex = 'false';
  bar.hidden = true;
  bar.innerHTML = `
    <input class="editor-command-find editor-command-field" type="text" placeholder="Find" autocomplete="off" />
    <button class="editor-command-regex" type="button" title="Regular expression search and replace">.*</button>
    <span class="editor-command-count">0/0</span>
    <button class="editor-command-prev" type="button" title="Previous match">Prev</button>
    <button class="editor-command-next" type="button" title="Next match">Next</button>
    <textarea class="editor-command-replace editor-command-field" rows="3" placeholder="Replace" autocomplete="off"></textarea>
    <button class="editor-command-replace-one" type="button" title="Replace current match (Alt+Enter)">Replace</button>
    <button class="editor-command-replace-all" type="button" title="Replace all matches">All</button>
    <button class="editor-command-close" type="button" title="Close">x</button>`;
  wrapper.appendChild(bar);

  const findInput = bar.querySelector('.editor-command-find');
  const replaceInput = bar.querySelector('.editor-command-replace');

  bar._mindgitEditor = editor;
  bar._mindgitFindInput = findInput;
  bar._mindgitReplaceInput = replaceInput;
  bar._mindgitCount = bar.querySelector('.editor-command-count');
  bar._mindgitRegexToggle = bar.querySelector('.editor-command-regex');

  setEditorRegexMode(bar, false);

  bar.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      hideEditorFindBar(bar);
      return;
    }
    const key = event.key.toLowerCase();
    if (!event.ctrlKey || event.altKey) return;
    if (key === 's') {
      event.preventDefault();
      saveFile();
    } else if (key === 'f') {
      event.preventDefault();
      showEditorFindBar(bar);
    } else if (key === 'g') {
      event.preventDefault();
      showEditorLineBar(editor._mindgitLineBar);
    }
  });

  findInput.addEventListener('input', () => {
    updateFindBarMatches(bar);
    selectEditorMatch(bar, 1, true);
  });
  findInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      selectEditorMatch(bar, event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      hideEditorFindBar(bar);
    }
  });
  replaceInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideEditorFindBar(bar);
    } else if (event.key === 'Enter' && event.altKey) {
      event.preventDefault();
      replaceCurrentEditorMatch(bar);
    }
  });

  bar.querySelector('.editor-command-prev').addEventListener('click', () => {
    selectEditorMatch(bar, -1);
    focusWithoutScroll(findInput);
  });
  bar.querySelector('.editor-command-next').addEventListener('click', () => {
    selectEditorMatch(bar, 1);
    focusWithoutScroll(findInput);
  });
  bar.querySelector('.editor-command-replace-one').addEventListener('click', () => replaceCurrentEditorMatch(bar));
  bar.querySelector('.editor-command-replace-all').addEventListener('click', () => replaceAllEditorMatches(bar));
  bar.querySelector('.editor-command-close').addEventListener('click', () => hideEditorFindBar(bar));
  bar._mindgitRegexToggle.addEventListener('click', () => {
    setEditorRegexMode(bar, !isEditorRegexMode(bar));
    updateFindBarMatches(bar);
    renderEditorFindHighlights(bar);
    focusWithoutScroll(findInput);
  });
  editor._mindgitFindBar = bar;
  return bar;
}

function createEditorLineBar(editor) {
  const wrapper = editor.closest('.editor-wrapper');
  const bar = document.createElement('div');
  bar.className = 'editor-command-bar editor-command-bar-line';
  bar.hidden = true;
  bar.innerHTML = `
    <input class="editor-command-line editor-command-field" type="number" placeholder="Line" autocomplete="off" />
    <button class="editor-command-go" type="button" title="Go to line">Go</button>
    <button class="editor-command-close" type="button" title="Close">x</button>`;
  wrapper.appendChild(bar);

  const lineInput = bar.querySelector('.editor-command-line');
  bar._mindgitEditor = editor;
  bar._mindgitLineInput = lineInput;

  bar.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      hideEditorLineBar(bar);
      return;
    }
    const key = event.key.toLowerCase();
    if (!event.ctrlKey || event.altKey) return;
    if (key === 's') {
      event.preventDefault();
      saveFile();
    } else if (key === 'f') {
      event.preventDefault();
      showEditorFindBar(editor._mindgitFindBar);
    } else if (key === 'g') {
      event.preventDefault();
      showEditorLineBar(bar);
    }
  });

  lineInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      goToEditorLineFromBar(bar);
    } else if (event.key === 'Escape') {
      hideEditorLineBar(bar);
    }
  });

  bar.querySelector('.editor-command-go').addEventListener('click', () => goToEditorLineFromBar(bar));
  bar.querySelector('.editor-command-close').addEventListener('click', () => hideEditorLineBar(bar));
  editor._mindgitLineBar = bar;
  return bar;
}

function showEditorFindBar(bar) {
  if (!bar) return;
  hideEditorLineBar(bar._mindgitEditor?._mindgitLineBar, { restoreFocus: false });
  bar.hidden = false;
  bar._mindgitSuppressedSelection = null;
  const selectedText = getSelectedEditorText(bar._mindgitEditor);
  if (selectedText && !bar._mindgitFindInput.value) {
    bar._mindgitFindInput.value = selectedText;
  }
  updateFindBarMatches(bar);
  renderEditorFindHighlights(bar);
  focusAndSelectField(bar._mindgitFindInput);
}

function hideEditorFindBar(bar, options = {}) {
  if (!bar) return;
  const editor = bar._mindgitEditor;
  if (editor && editor.selectionStart !== editor.selectionEnd) {
    bar._mindgitSuppressedSelection = {
      value: editor.value,
      start: editor.selectionStart,
      end: editor.selectionEnd,
    };
  }
  bar.hidden = true;
  renderEditorFindHighlights(bar);
  if (options.restoreFocus !== false) {
    bar._mindgitEditor.focus();
  }
}

function showEditorLineBar(bar) {
  if (!bar) return;
  hideEditorFindBar(bar._mindgitEditor?._mindgitFindBar, { restoreFocus: false });
  bar.hidden = false;
  focusAndSelectField(bar._mindgitLineInput);
}

function hideEditorLineBar(bar, options = {}) {
  if (!bar) return;
  bar.hidden = true;
  if (options.restoreFocus !== false) {
    bar._mindgitEditor.focus();
  }
}

function focusAndSelectField(field) {
  if (!field) return;
  focusWithoutScroll(field);
  if (typeof field.select === 'function') {
    try {
      field.select();
      return;
    } catch {}
  }
  if (typeof field.setSelectionRange === 'function') {
    try {
      field.setSelectionRange(0, String(field.value || '').length);
    } catch {}
  }
}

function getSelectedEditorText(editor) {
  if (!editor || editor.selectionStart === editor.selectionEnd) return '';
  return editor.value.slice(editor.selectionStart, editor.selectionEnd);
}

function resolveEditorLineNumber(lines, lineNum) {
  if (!lines.length) return 1;
  if (lineNum < 0) {
    return Math.max(1, Math.min(lines.length, lines.length + lineNum + 1));
  }
  return Math.max(1, Math.min(lines.length, lineNum));
}

function normalizedFindText(value) {
  return value.toLocaleLowerCase();
}

function isEditorRegexMode(bar) {
  return bar?.dataset.regex === 'true';
}

function setEditorRegexMode(bar, enabled) {
  const next = Boolean(enabled);
  bar.dataset.regex = next ? 'true' : 'false';
  bar._mindgitRegexToggle?.classList.toggle('active', next);
  bar._mindgitRegexToggle?.setAttribute('aria-pressed', next ? 'true' : 'false');
}

function editorMatches(editor, query, options = {}) {
  if (!query) return { matches: [], error: '' };

  if (!options.regex) {
    const text = normalizedFindText(editor.value);
    const needle = normalizedFindText(query);
    const matches = [];
    let index = text.indexOf(needle);
    while (index !== -1) {
      matches.push({
        start: index,
        end: index + query.length,
        text: editor.value.slice(index, index + query.length),
      });
      index = text.indexOf(needle, index + Math.max(1, query.length));
    }
    return { matches, error: '' };
  }

  let regex;
  try {
    regex = new RegExp(query, 'gm');
  } catch (error) {
    return { matches: [], error: error?.message || 'Invalid regular expression' };
  }

  const matches = [];
  const text = editor.value;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const value = match[0] ?? '';
    matches.push({
      start: match.index,
      end: match.index + value.length,
      text: value,
      captures: match.slice(1),
      groups: match.groups || {},
    });
    if (value === '') {
      regex.lastIndex += 1;
    }
  }

  return { matches, error: '' };
}

function currentEditorMatchIndex(editor, matches) {
  return matches.findIndex((match) => match.start === editor.selectionStart && match.end === editor.selectionEnd);
}

function updateFindBarMatches(bar) {
  if (bar.hidden) return;
  const editor = bar._mindgitEditor;
  const query = bar._mindgitFindInput.value;
  const { matches, error } = editorMatches(editor, query, { regex: isEditorRegexMode(bar) });
  bar._mindgitCount.classList.toggle('invalid', Boolean(error));
  bar._mindgitCount.title = error || '';
  if (error) {
    bar._mindgitCount.textContent = 'Regex error';
    return;
  }
  const current = currentEditorMatchIndex(editor, matches);
  bar._mindgitCount.textContent = matches.length ? `${Math.max(1, current + 1)}/${matches.length}` : '0/0';
}

function selectEditorMatch(bar, direction, fromStart = false) {
  const editor = bar._mindgitEditor;
  const query = bar._mindgitFindInput.value;
  const { matches, error } = editorMatches(editor, query, { regex: isEditorRegexMode(bar) });
  if (error || !matches.length) {
    updateFindBarMatches(bar);
    renderEditorFindHighlights(bar);
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
  editor.setSelectionRange(match.start, match.end);
  centerEditorSelection(editor, match.start, match.end);
  updateFindBarMatches(bar);
  renderEditorFindHighlights(bar);
  return true;
}

function expandRegexReplacement(template, match, fullText) {
  return template.replace(/\$(\$|&|`|'|<[^>]+>|\d{1,2})/g, (whole, token) => {
    if (token === '$') return '$';
    if (token === '&') return match.text;
    if (token === '`') return fullText.slice(0, match.start);
    if (token === "'") return fullText.slice(match.end);
    if (token.startsWith('<') && token.endsWith('>')) {
      const name = token.slice(1, -1);
      return match.groups?.[name] ?? '';
    }
    if (!/^\d{1,2}$/.test(token)) return whole;
    const index = Number(token);
    if (!index) return whole;
    if (index <= (match.captures?.length || 0)) {
      return match.captures[index - 1] ?? '';
    }
    if (token.length === 2) {
      const fallbackIndex = Number(token[0]);
      if (fallbackIndex && fallbackIndex <= (match.captures?.length || 0)) {
        return `${match.captures[fallbackIndex - 1] ?? ''}${token[1]}`;
      }
    }
    return whole;
  });
}

function decodeReplacementEscapes(template) {
  let result = '';
  for (let i = 0; i < template.length; i++) {
    const char = template[i];
    if (char !== '\\' || i === template.length - 1) {
      result += char;
      continue;
    }

    const next = template[i + 1];
    if (next === 'n') {
      result += '\n';
    } else if (next === 'r') {
      result += '\r';
    } else if (next === 't') {
      result += '\t';
    } else if (next === '\\') {
      result += '\\';
    } else {
      result += next;
    }
    i += 1;
  }
  return result;
}

function replacementForEditorMatch(match, replacement, regexMode, fullText) {
  const normalizedReplacement = decodeReplacementEscapes(replacement);
  if (!regexMode) return normalizedReplacement;
  return expandRegexReplacement(normalizedReplacement, match, fullText);
}

function replaceCurrentEditorMatch(bar) {
  const editor = bar._mindgitEditor;
  const query = bar._mindgitFindInput.value;
  if (!query) return;

  const regexMode = isEditorRegexMode(bar);
  let { matches, error } = editorMatches(editor, query, { regex: regexMode });
  if (error) {
    updateFindBarMatches(bar);
    renderEditorFindHighlights(bar);
    return;
  }

  let current = currentEditorMatchIndex(editor, matches);
  if (current === -1) {
    if (!selectEditorMatch(bar, 1)) return;
    ({ matches, error } = editorMatches(editor, query, { regex: regexMode }));
    if (error) return;
    current = currentEditorMatchIndex(editor, matches);
    if (current === -1) return;
  }

  const match = matches[current];
  const start = match.start;
  const end = match.end;
  const replacement = bar._mindgitReplaceInput.value;
  const nextText = replacementForEditorMatch(match, replacement, regexMode, editor.value);
  editor.value = editor.value.slice(0, start) + nextText + editor.value.slice(end);
  editor.setSelectionRange(start, start + nextText.length);
  editor.dispatchEvent(new Event('input'));
  selectEditorMatch(bar, 1);
}

function replaceAllEditorMatches(bar) {
  const editor = bar._mindgitEditor;
  const query = bar._mindgitFindInput.value;
  if (!query) return;

  const regexMode = isEditorRegexMode(bar);
  const { matches, error } = editorMatches(editor, query, { regex: regexMode });
  if (error || !matches.length) {
    updateFindBarMatches(bar);
    return;
  }

  const replacement = bar._mindgitReplaceInput.value;
  let nextValue = '';
  let cursor = 0;
  for (const match of matches) {
    nextValue += editor.value.slice(cursor, match.start) + replacementForEditorMatch(match, replacement, regexMode, editor.value);
    cursor = match.end;
  }
  nextValue += editor.value.slice(cursor);
  editor.value = nextValue;
  editor.setSelectionRange(0, 0);
  editor.dispatchEvent(new Event('input'));
  updateFindBarMatches(bar);
  setMessage(`Replaced ${matches.length} matches`, 'ok');
}

function goToEditorLineFromBar(bar) {
  const editor = bar._mindgitEditor;
  const lineNum = parseInt(bar._mindgitLineInput.value, 10);
  if (!Number.isInteger(lineNum)) return;
  goToEditorLine(editor, lineNum, { focusEditor: false });
  focusWithoutScroll(bar._mindgitLineInput);
}

function goToEditorLine(editor, lineNum, options = {}) {
  const lines = splitEditorLines(editor.value);
  const target = resolveEditorLineNumber(lines, lineNum);
  const pos = getLineStartPositionFromLines(lines, target);
  editor.setSelectionRange(pos, pos);
  centerEditorSelection(editor, pos, pos, 20);
  if (options.focusEditor !== false) {
    editor.focus();
  }
}

function syncEditorHighlightScroll(editor, highlight) {
  if (!editor || !highlight) return;
  highlight.scrollTop = editor.scrollTop;
  highlight.scrollLeft = editor.scrollLeft;
}

function renderEditorFindHighlights(bar) {
  const editor = bar?._mindgitEditor;
  const highlight = $('editor-highlight');
  if (!editor || !highlight) return;
  if (editor.classList.contains('large-document')) {
    highlight.innerHTML = '';
    highlight.style.display = 'none';
    renderEditorSelectionMatchHighlights(editor, editor._mindgitSelectionMatchOverlay, []);
    return;
  }
  const selectionMatchOverlay = editor._mindgitSelectionMatchOverlay;

  const selectedText = getSelectedEditorText(editor);
  const suppressedSelection = bar._mindgitSuppressedSelection;
  const useSelection = bar.hidden
    && selectedText.length > 0
    && (!suppressedSelection
      || suppressedSelection.value !== editor.value
      || suppressedSelection.start !== editor.selectionStart
      || suppressedSelection.end !== editor.selectionEnd);
  const query = bar.hidden
    ? (useSelection ? selectedText : '')
    : bar._mindgitFindInput.value;
  const { matches, error } = editorMatches(editor, query, {
    regex: useSelection ? false : isEditorRegexMode(bar),
  });
  if (!query || error || !matches.length) {
    highlight.innerHTML = '';
    highlight.style.display = 'none';
    renderEditorSelectionMatchHighlights(editor, selectionMatchOverlay, []);
    return;
  }

  let currentIndex = currentEditorMatchIndex(editor, matches);
  if (currentIndex === -1) currentIndex = 0;

  if (useSelection) {
    highlight.innerHTML = '';
    highlight.style.display = 'none';
    renderEditorSelectionMatchHighlights(editor, selectionMatchOverlay, matches, currentIndex);
    return;
  }

  renderEditorSelectionMatchHighlights(editor, selectionMatchOverlay, []);

  let cursor = 0;
  let html = '';
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    html += escapeHTML(editor.value.slice(cursor, match.start));
    html += renderEditorFindMatchHTML(
      editor.value.slice(match.start, match.end),
      i === currentIndex,
    );
    cursor = match.end;
  }
  html += escapeHTML(editor.value.slice(cursor));

  highlight.innerHTML = html || ' ';
  highlight.style.display = 'block';
  syncEditorHighlightScroll(editor, highlight);
}

function captureEditorCommandState(editor) {
  const findBar = editor?._mindgitFindBar;
  const lineBar = editor?._mindgitLineBar;
  return {
    find: findBar ? {
      open: !findBar.hidden,
      query: findBar._mindgitFindInput.value,
      replace: findBar._mindgitReplaceInput.value,
      regex: isEditorRegexMode(findBar),
    } : null,
    line: lineBar ? {
      open: !lineBar.hidden,
      value: lineBar._mindgitLineInput.value,
    } : null,
  };
}

function restoreEditorCommandState(editor, commandState) {
  if (!editor || !commandState) return;
  const findBar = editor._mindgitFindBar;
  const lineBar = editor._mindgitLineBar;

  if (findBar && commandState.find) {
    findBar._mindgitFindInput.value = commandState.find.query || '';
    findBar._mindgitReplaceInput.value = commandState.find.replace || '';
    setEditorRegexMode(findBar, Boolean(commandState.find.regex));
    findBar.hidden = !commandState.find.open;
    findBar._mindgitSuppressedSelection = !commandState.find.open
      && editor.selectionStart !== editor.selectionEnd
      ? {
        value: editor.value,
        start: editor.selectionStart,
        end: editor.selectionEnd,
      }
      : null;
    updateFindBarMatches(findBar);
    renderEditorFindHighlights(findBar);
  }

  if (lineBar && commandState.line) {
    lineBar._mindgitLineInput.value = commandState.line.value || '';
    lineBar.hidden = !commandState.line.open;
  }

  if (findBar && lineBar && !findBar.hidden && !lineBar.hidden) {
    lineBar.hidden = true;
  }
}

function renderEditorFindMatchHTML(text, isCurrent) {
  const className = `editor-find-match${isCurrent ? ' current' : ''}`;
  if (text.length === 0) {
    return `<mark class="${className} zero-width"><span class="editor-find-boundary"></span></mark>`;
  }

  let html = '';
  let segment = '';
  const flushSegment = () => {
    if (!segment) return;
    html += `<mark class="${className}">${escapeHTML(segment)}</mark>`;
    segment = '';
  };

  for (const char of text) {
    if (char === '\n') {
      flushSegment();
      html += `<mark class="${className} linebreak"><span class="editor-find-boundary"></span></mark>\n`;
      continue;
    }
    segment += char;
  }

  flushSegment();
  return html || `<mark class="${className} zero-width"><span class="editor-find-boundary"></span></mark>`;
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

function duplicateSelectedLines(editor, direction, selection = null) {
  const originalLines = splitEditorLines(editor.value);
  let startLine = 0;
  let endLine = 0;
  let cursorPoint = null;
  let hadSelection = false;

  if (selection) {
    const bounds = getBlockBounds(editor, selection);
    startLine = bounds.startRow;
    endLine = bounds.endRow;
  } else {
    ({ startLine, endLine } = selectedLineRange(editor));
    hadSelection = editor.selectionStart !== editor.selectionEnd;
    cursorPoint = findLineAndColumnAtPosition(originalLines, editor.selectionStart);
  }

  const copiedLines = originalLines.slice(startLine, endLine + 1);
  const lineCount = copiedLines.length;
  const nextLines = originalLines.slice();
  const insertAt = direction < 0 ? startLine : endLine + 1;

  nextLines.splice(insertAt, 0, ...copiedLines);
  editor.value = nextLines.join('\n');

  const copiedStartLine = direction < 0 ? startLine : startLine + lineCount;
  const copiedEndLine = copiedStartLine + lineCount - 1;

  if (selection) {
    editor.scrollTop += direction * 20;
    return true;
  }

  if (hadSelection) {
    const nextStart = lineStartOffset(nextLines, copiedStartLine);
    const nextEnd = lineStartOffset(nextLines, copiedEndLine) + nextLines[copiedEndLine].length;
    editor.setSelectionRange(nextStart, nextEnd);
  } else if (cursorPoint) {
    const targetRow = direction < 0 ? cursorPoint.lineIndex : cursorPoint.lineIndex + lineCount;
    const nextCursor = getPositionFromRowCol(editor, targetRow, cursorPoint.column);
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
  const effectiveEnd = end > start && editor.value[end - 1] === '\n' ? end - 1 : end;
  const text = editor.value;
  const lines = splitEditorLines(text);

  let startLine = 0;
  let endLine = 0;
  let pos = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineEnd = pos + lines[i].length;
    if (pos <= start && start <= lineEnd) startLine = i;
    if (pos <= effectiveEnd && effectiveEnd <= lineEnd) endLine = i;
    pos = lineEnd + 1;
  }

  if (start === end || startLine === endLine) {
    if (isShiftTab) {
      const lineStart = lines.slice(0, startLine).join('\n').length + (startLine > 0 ? 1 : 0);
      const lineText = lines[startLine];
      const indentWidth = indentRemovalWidth(lineText);

      if (indentWidth > 0) {
        lines[startLine] = lineText.substring(indentWidth);
        editor.value = lines.join('\n');
        const newPos = Math.max(lineStart, start - indentWidth);
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
      const indentWidth = indentRemovalWidth(lines[i]);
      if (indentWidth > 0) {
        lines[i] = lines[i].substring(indentWidth);
        if (i === startLine) newStart = Math.max(0, newStart - indentWidth);
        newEnd -= indentWidth;
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

function indentRemovalWidth(line) {
  if (line.startsWith('\t')) return 1;
  if (line.startsWith('  ')) return 2;
  if (line.startsWith(' ')) return 1;
  return 0;
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

function createSelectionMatchOverlay(editor) {
  const overlay = document.createElement('div');
  overlay.className = 'editor-selection-matches';
  editor.parentElement.appendChild(overlay);
  editor._mindgitSelectionMatchOverlay = overlay;
  return overlay;
}

function createEditorLinkHintOverlay(editor) {
  const overlay = document.createElement('div');
  overlay.className = 'editor-link-hint';
  overlay.hidden = true;
  editor.parentElement.appendChild(overlay);
  return overlay;
}

function clearEditorMeasurementCache(editor) {
  editor._mindgitPrefixWidthCache = new Map();
}

function clearEditorWrapLayoutCache(editor) {
  editor._mindgitWrapLayout = null;
}

function getEditorMeasurementLayer(editor) {
  const style = getComputedStyle(editor);
  const signature = `${style.font}|${style.letterSpacing}|${style.tabSize}`;
  let layer = editor._mindgitMeasurementLayer;

  if (!layer || layer.signature !== signature || !layer.root?.isConnected) {
    layer?.root?.remove();

    const root = document.createElement('div');
    root.style.position = 'fixed';
    root.style.left = '-99999px';
    root.style.top = '0';
    root.style.visibility = 'hidden';
    root.style.pointerEvents = 'none';
    root.style.whiteSpace = 'pre';
    root.style.margin = '0';
    root.style.padding = '0';
    root.style.border = '0';
    root.style.font = style.font;
    root.style.letterSpacing = style.letterSpacing;
    root.style.lineHeight = style.lineHeight;
    root.style.tabSize = style.tabSize;
    root.style.fontKerning = style.fontKerning;
    root.style.fontFeatureSettings = style.fontFeatureSettings;
    root.style.fontVariantLigatures = style.fontVariantLigatures;

    const span = document.createElement('span');
    const textNode = document.createTextNode('');
    span.appendChild(textNode);
    root.appendChild(span);
    document.body.appendChild(root);

    layer = {
      signature,
      root,
      textNode,
      range: document.createRange(),
    };
    editor._mindgitMeasurementLayer = layer;
    clearEditorMeasurementCache(editor);
  }

  return layer;
}

function getEditorWrapMeasurementLayer(editor) {
  const style = getComputedStyle(editor);
  const signature = `${style.font}|${style.letterSpacing}|${style.lineHeight}|${style.tabSize}`;
  let layer = editor._mindgitWrapMeasurementLayer;

  if (!layer || layer.signature !== signature || !layer.root?.isConnected) {
    layer?.root?.remove();

    const root = document.createElement('div');
    root.style.position = 'fixed';
    root.style.left = '-99999px';
    root.style.top = '0';
    root.style.visibility = 'hidden';
    root.style.pointerEvents = 'none';
    root.style.margin = '0';
    root.style.padding = '0';
    root.style.border = '0';
    root.style.boxSizing = 'border-box';
    root.style.font = style.font;
    root.style.letterSpacing = style.letterSpacing;
    root.style.lineHeight = style.lineHeight;
    root.style.tabSize = style.tabSize;
    root.style.whiteSpace = 'normal';

    document.body.appendChild(root);
    layer = { signature, root };
    editor._mindgitWrapMeasurementLayer = layer;
    clearEditorWrapLayoutCache(editor);
  }

  return layer;
}

function getEditorWrappedLineLayout(editor, lineHeight = 20) {
  if (editor.classList.contains('large-document') || !editor.classList.contains('wrap-enabled')) return null;

  const style = getComputedStyle(editor);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingRight = parseFloat(style.paddingRight) || 0;
  // Textarea controls keep a small internal wrap boundary that is not exposed
  // through clientWidth. A two-pixel allowance prevents a borderline line from
  // being measured one visual row shorter than the browser renders it.
  const contentWidth = Math.max(0, Math.floor(editor.clientWidth - paddingLeft - paddingRight - 2));
  const cached = editor._mindgitWrapLayout;
  if (cached && cached.width === contentWidth && cached.value === editor.value) {
    return cached;
  }

  const lines = splitEditorLines(editor.value);
  if (contentWidth <= 0) {
    const heights = lines.map(() => lineHeight);
    const tops = [];
    let offset = 0;
    for (const height of heights) {
      tops.push(offset);
      offset += height;
    }
    const fallback = { width: contentWidth, value: editor.value, heights, tops, totalHeight: offset };
    editor._mindgitWrapLayout = fallback;
    return fallback;
  }

  const layer = getEditorWrapMeasurementLayer(editor);
  layer.root.style.width = `${contentWidth}px`;
  layer.root.innerHTML = '';

  const fragment = document.createDocumentFragment();
  for (const line of lines) {
    const row = document.createElement('div');
    row.style.whiteSpace = 'pre-wrap';
    row.style.wordWrap = 'break-word';
    row.style.overflowWrap = 'break-word';
    row.style.boxSizing = 'border-box';
    row.textContent = line || ' ';
    fragment.appendChild(row);
  }
  layer.root.appendChild(fragment);

  const heights = [];
  const tops = [];
  let offset = 0;
  for (const row of layer.root.children) {
    const measured = Math.max(lineHeight, Math.ceil(row.getBoundingClientRect().height));
    heights.push(measured);
    tops.push(offset);
    offset += measured;
  }

  const layout = { width: contentWidth, value: editor.value, heights, tops, totalHeight: offset };
  editor._mindgitWrapLayout = layout;
  return layout;
}

function syncEditorLineNumberLayout(editor, lineNumbersEl, lineHeight = 20) {
  if (!editor || !lineNumbersEl) return;

  const spans = lineNumbersEl.querySelectorAll('.editor-line-num');
  if (!spans.length) return;

  const wrapLayout = getEditorWrappedLineLayout(editor, lineHeight);
  if (!wrapLayout) {
    for (const span of spans) {
      span.style.height = '';
      span.style.lineHeight = `${lineHeight}px`;
    }
    return;
  }

  spans.forEach((span, index) => {
    span.style.height = `${wrapLayout.heights[index] || lineHeight}px`;
    span.style.lineHeight = `${lineHeight}px`;
  });
}

function getEditorVisualLineMetrics(editor, row, lineHeight = 20) {
  const wrapLayout = getEditorWrappedLineLayout(editor, lineHeight);
  if (!wrapLayout) {
    return {
      top: row * lineHeight,
      height: lineHeight,
    };
  }

  const index = Math.max(0, Math.min(row, wrapLayout.heights.length - 1));
  return {
    top: wrapLayout.tops[index] || 0,
    height: wrapLayout.heights[index] || lineHeight,
  };
}

function findEditorRowAtVerticalOffset(editor, offsetY, lineHeight = 20) {
  const wrapLayout = getEditorWrappedLineLayout(editor, lineHeight);
  if (!wrapLayout) {
    const lines = splitEditorLines(editor.value);
    return Math.max(0, Math.min(lines.length - 1, Math.floor(offsetY / lineHeight)));
  }

  const tops = wrapLayout.tops;
  const heights = wrapLayout.heights;
  if (!tops.length) return 0;
  if (offsetY <= 0) return 0;

  let low = 0;
  let high = tops.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const top = tops[mid] || 0;
    const bottom = top + (heights[mid] || lineHeight);
    if (offsetY < top) {
      high = mid - 1;
    } else if (offsetY >= bottom) {
      low = mid + 1;
    } else {
      return mid;
    }
  }

  return Math.max(0, Math.min(tops.length - 1, low));
}

function getEditorLinePrefixWidths(editor, line) {
  const cache = editor._mindgitPrefixWidthCache || (editor._mindgitPrefixWidthCache = new Map());
  const key = line ?? '';
  if (cache.has(key)) {
    return cache.get(key);
  }

  const layer = getEditorMeasurementLayer(editor);
  const text = key || ' ';
  layer.textNode.data = text;

  const prefixWidths = new Array(key.length + 1);
  prefixWidths[0] = 0;

  for (let i = 1; i <= key.length; i++) {
    layer.range.setStart(layer.textNode, 0);
    layer.range.setEnd(layer.textNode, i);
    prefixWidths[i] = layer.range.getBoundingClientRect().width;
  }

  cache.set(key, prefixWidths);
  return prefixWidths;
}

function getEditorColumnOffset(editor, line, col) {
  const prefixWidths = getEditorLinePrefixWidths(editor, line);
  const nextCol = Math.max(0, Math.min(col, prefixWidths.length - 1));
  return prefixWidths[nextCol] || 0;
}

function getEditorColumnsWidth(editor, line, startCol, endCol) {
  const start = Math.max(0, Math.min(startCol, line.length));
  const end = Math.max(0, Math.min(endCol, line.length));
  return Math.abs(getEditorColumnOffset(editor, line, end) - getEditorColumnOffset(editor, line, start));
}

function getEditorColumnFromOffset(editor, line, offset) {
  if (!line) return 0;

  const prefixWidths = getEditorLinePrefixWidths(editor, line);
  const maxWidth = prefixWidths[prefixWidths.length - 1] || 0;
  if (offset <= 0) return 0;
  if (offset >= maxWidth) return line.length;

  let low = 0;
  let high = prefixWidths.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (prefixWidths[mid] < offset) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const next = low;
  const prev = Math.max(0, next - 1);
  return Math.abs(prefixWidths[next] - offset) <= Math.abs(offset - prefixWidths[prev]) ? next : prev;
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
    ? getEditorColumnsWidth(editor, lines[startPos.lineIndex] || '', startPos.column, endPos.column)
    : 1;

  const wrapLayout = getEditorWrappedLineLayout(editor, lineHeight);
  const visualLineTop = wrapLayout ? (wrapLayout.tops[focusLine] || 0) : (focusLine * lineHeight);
  const visualLineHeight = wrapLayout ? (wrapLayout.heights[focusLine] || lineHeight) : lineHeight;
  const targetTop = visualLineTop - Math.max(0, (editor.clientHeight - visualLineHeight) / 2);
  editor.scrollTop = Math.max(0, targetTop);

  if (editor.classList.contains('wrap-enabled')) return;

  const style = getComputedStyle(editor);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const charWidth = getEditorCharWidth(editor);
  const line = lines[focusLine] || '';
  const focusWidth = Math.max(charWidth, selectionColumns);
  const targetLeft = paddingLeft + getEditorColumnOffset(editor, line, focusColumn)
    - Math.max(0, (editor.clientWidth - focusWidth) / 2);
  editor.scrollLeft = Math.max(0, targetLeft);
}

function getMouseRowCol(editor, event, lineHeight) {
  const rect = editor.getBoundingClientRect();
  const style = getComputedStyle(editor);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const lines = splitEditorLines(editor.value);

  const contentX = event.clientX - rect.left + editor.scrollLeft - paddingLeft;
  const contentY = event.clientY - rect.top + editor.scrollTop - paddingTop;
  const row = Math.max(0, Math.min(lines.length - 1, findEditorRowAtVerticalOffset(editor, contentY, lineHeight)));
  const line = lines[row] || '';
  const col = getEditorColumnFromOffset(editor, line, Math.max(0, contentX));

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

function cloneBlockSelection(selection) {
  if (!selection) return null;
  const cloned = {};
  if (selection.anchor) {
    cloned.anchor = { row: selection.anchor.row, col: selection.anchor.col };
  }
  if (selection.focus) {
    cloned.focus = { row: selection.focus.row, col: selection.focus.col };
  }
  if (Array.isArray(selection.ranges)) {
    cloned.ranges = selection.ranges.map((range) => ({
      row: range.row,
      anchorCol: range.anchorCol,
      focusCol: range.focusCol,
    }));
  }
  if (typeof selection.focusIndex === 'number') {
    cloned.focusIndex = selection.focusIndex;
  }
  return cloned;
}

function shiftBlockSelectionRows(selection, rowDelta) {
  if (!selection || !rowDelta) return cloneBlockSelection(selection);

  if (Array.isArray(selection.ranges)) {
    return {
      ranges: selection.ranges.map((range) => ({
        row: range.row + rowDelta,
        anchorCol: range.anchorCol,
        focusCol: range.focusCol,
      })),
      focusIndex: selection.focusIndex,
    };
  }

  if (selection.anchor && selection.focus) {
    return {
      anchor: {
        row: selection.anchor.row + rowDelta,
        col: selection.anchor.col,
      },
      focus: {
        row: selection.focus.row + rowDelta,
        col: selection.focus.col,
      },
    };
  }

  return cloneBlockSelection(selection);
}

function blockSelectionsEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;

  const pointsEqual = (left, right) => {
    if (!left && !right) return true;
    if (!left || !right) return false;
    return left.row === right.row && left.col === right.col;
  };

  if (!pointsEqual(a.anchor, b.anchor) || !pointsEqual(a.focus, b.focus)) {
    return false;
  }

  const leftRanges = Array.isArray(a.ranges) ? a.ranges : [];
  const rightRanges = Array.isArray(b.ranges) ? b.ranges : [];
  if (leftRanges.length !== rightRanges.length) return false;

  for (let i = 0; i < leftRanges.length; i++) {
    const left = leftRanges[i];
    const right = rightRanges[i];
    if (
      left.row !== right.row ||
      left.anchorCol !== right.anchorCol ||
      left.focusCol !== right.focusCol
    ) {
      return false;
    }
  }

  return (a.focusIndex ?? -1) === (b.focusIndex ?? -1);
}

function createColumnBlockSelection(anchor, focus) {
  return {
    anchor: { row: anchor.row, col: anchor.col },
    focus: { row: focus.row, col: focus.col },
  };
}

function addBlockSelectionCaret(editor, selection, point) {
  const ranges = selection ? getBlockSelectionRanges(editor, selection).map((range) => ({
    row: range.row,
    anchorCol: range.focusCol,
    focusCol: range.focusCol,
  })) : [];
  const existing = ranges.findIndex((range) => range.row === point.row && range.focusCol === point.col);
  if (existing >= 0) ranges.splice(existing, 1);
  else ranges.push({ row: point.row, anchorCol: point.col, focusCol: point.col });
  ranges.sort((a, b) => a.row - b.row || a.focusCol - b.focusCol);
  return {
    ranges,
    focusIndex: Math.max(0, ranges.findIndex((range) => range.row === point.row && range.focusCol === point.col)),
  };
}

function addBlockSelectionColumn(editor, selection, anchor, focus) {
  const ranges = selection ? getBlockSelectionRanges(editor, selection).map((range) => ({
    row: range.row,
    anchorCol: range.focusCol,
    focusCol: range.focusCol,
  })) : [];
  const startRow = Math.min(anchor.row, focus.row);
  const endRow = Math.max(anchor.row, focus.row);
  for (let row = startRow; row <= endRow; row++) {
    ranges.push({
      row,
      anchorCol: anchor.col,
      focusCol: focus.col,
    });
  }
  ranges.sort((a, b) => a.row - b.row || a.focusCol - b.focusCol);
  return {
    ranges,
    focusIndex: Math.max(0, ranges.findIndex((range) => range.row === focus.row && range.focusCol === focus.col)),
  };
}

function changedTextBetween(previous, next) {
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (previousEnd > start && nextEnd > start && previous[previousEnd - 1] === next[nextEnd - 1]) {
    previousEnd--;
    nextEnd--;
  }
  if (previous.slice(0, start) !== next.slice(0, start) || previous.slice(previousEnd) !== next.slice(nextEnd)) return null;
  return next.slice(start, nextEnd);
}

function revealMobileLineStart(editor) {
  if (!editor || !window.matchMedia('(max-width: 900px)').matches || editor.classList.contains('wrap-enabled')) return;
  const lineStart = editor.value.lastIndexOf('\n', Math.max(0, editor.selectionStart - 1)) + 1;
  const style = getComputedStyle(editor);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const line = editor.value.slice(lineStart, editor.value.indexOf('\n', lineStart) === -1 ? editor.value.length : editor.value.indexOf('\n', lineStart));
  const width = getEditorColumnOffset(editor, line, Math.min(editor.selectionStart - lineStart, line.length));
  const right = width + paddingLeft;
  if (right <= Math.min(96, editor.clientWidth / 3)) {
    editor.scrollLeft = 0;
  } else if (right > editor.scrollLeft + editor.clientWidth - 32) {
    editor.scrollLeft = Math.max(0, right - editor.clientWidth + 32);
  }
}

function setEditorWordWrap(enabled) {
  state.wordWrap = Boolean(enabled);
  localStorage.setItem('mindgit-wordwrap', state.wordWrap);
  const editor = $('editor');
  const highlightEl = $('editor-highlight');
  const lineNumbersEl = $('editor-line-numbers');
  if (!editor) return;
  const wrapClass = state.wordWrap ? 'wrap-enabled' : 'wrap-disabled';
  const removeClass = state.wordWrap ? 'wrap-disabled' : 'wrap-enabled';
  editor.classList.remove(removeClass);
  editor.classList.add(wrapClass);
  highlightEl?.classList.remove(removeClass);
  highlightEl?.classList.add(wrapClass);
  clearEditorWrapLayoutCache(editor);
  requestAnimationFrame(() => {
    syncEditorLineNumberLayout(editor, lineNumbersEl, 20);
    editor.dispatchEvent(new Event('scroll'));
  });
  setMessage(state.wordWrap ? 'Word wrap enabled' : 'Word wrap disabled', 'ok');
}

function getBlockSelectionRanges(editor, selection) {
  if (!selection) return [];

  const lines = splitEditorLines(editor.value);
  const normalizeRange = (range, index) => {
    const row = Math.max(0, Math.min(lines.length - 1, range.row));
    const line = lines[row] || '';
    const lineStartPos = getLineStartPositionFromLines(lines, row + 1);
    const anchorCol = Math.max(0, range.anchorCol);
    const focusCol = Math.max(0, range.focusCol);
    const actualAnchorCol = Math.min(anchorCol, line.length);
    const actualFocusCol = Math.min(focusCol, line.length);
    return {
      index,
      row,
      line,
      lineStartPos,
      anchorCol,
      focusCol,
      anchorPos: lineStartPos + actualAnchorCol,
      focusPos: lineStartPos + actualFocusCol,
      startCol: Math.min(actualAnchorCol, actualFocusCol),
      endCol: Math.max(actualAnchorCol, actualFocusCol),
      startPos: lineStartPos + Math.min(actualAnchorCol, actualFocusCol),
      endPos: lineStartPos + Math.max(actualAnchorCol, actualFocusCol),
    };
  };

  if (Array.isArray(selection.ranges) && selection.ranges.length) {
    return withVisualBlockSelectionIndexes(
      selection.ranges
        .map((range, index) => normalizeRange(range, index))
        .sort((a, b) => a.row - b.row || a.index - b.index)
    );
  }

  if (!selection.anchor || !selection.focus) return [];

  const startRow = Math.min(selection.anchor.row, selection.focus.row);
  const endRow = Math.max(selection.anchor.row, selection.focus.row);
  const ranges = [];
  for (let row = startRow; row <= endRow; row++) {
    ranges.push({
      row,
      anchorCol: selection.anchor.col,
      focusCol: selection.focus.col,
    });
  }
  return withVisualBlockSelectionIndexes(ranges.map((range, index) => normalizeRange(range, index)));
}

function withVisualBlockSelectionIndexes(ranges) {
  return ranges.map((range, visualIndex) => ({ ...range, visualIndex }));
}

function getBlockSelectionFocusIndex(selection, ranges) {
  if (!ranges.length) return -1;
  if (Array.isArray(selection?.ranges) && typeof selection.focusIndex === 'number') {
    return Math.max(0, Math.min(selection.focusIndex, ranges.length - 1));
  }
  if (selection?.focus) {
    const index = ranges.findIndex((range) => range.row === selection.focus.row);
    if (index !== -1) return index;
  }
  return Math.max(0, ranges.length - 1);
}

function getBlockSelectionFocusPoint(editor, selection) {
  const ranges = getBlockSelectionRanges(editor, selection);
  const focusIndex = getBlockSelectionFocusIndex(selection, ranges);
  if (focusIndex < 0) return null;
  const range = ranges[focusIndex];
  return { row: range.row, col: range.focusCol };
}

function isMultiLineBlockSelection(selection) {
  if (!selection) return false;
  if (Array.isArray(selection.ranges)) return selection.ranges.length > 1;
  return selection.anchor?.row !== selection.focus?.row;
}

function moveBlockSelection(editor, selection, key) {
  if (selection?.anchor && selection?.focus && !Array.isArray(selection.ranges)) {
    const lines = splitEditorLines(editor.value);
    const { startRow, endRow, startCol } = getBlockBounds(editor, selection);
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

  const lines = splitEditorLines(editor.value);
  const ranges = getBlockSelectionRanges(editor, selection);
  if (!ranges.length) return cloneBlockSelection(selection);

  const startRow = Math.min(...ranges.map((range) => range.row));
  const endRow = Math.max(...ranges.map((range) => range.row));
  const startCol = Math.min(...ranges.map((range) => Math.min(range.anchorCol, range.focusCol)));
  let rowDelta = 0;
  let colDelta = 0;

  if (key === 'ArrowUp' && startRow > 0) rowDelta = -1;
  if (key === 'ArrowDown' && endRow < lines.length - 1) rowDelta = 1;
  if (key === 'ArrowLeft' && startCol > 0) colDelta = -1;
  if (key === 'ArrowRight') colDelta = 1;

  return {
    ranges: ranges.map((range) => ({
      row: range.row + rowDelta,
      anchorCol: Math.max(0, range.anchorCol + colDelta),
      focusCol: Math.max(0, range.focusCol + colDelta),
    })),
    focusIndex: getBlockSelectionFocusIndex(selection, ranges),
  };
}

function moveBlockSelectionFocusWithCtrl(editor, selection, key) {
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    if (selection?.anchor && selection?.focus && !Array.isArray(selection.ranges)) {
      return createColumnBlockSelection(selection.anchor, moveBlockFocus(editor, selection.focus, key));
    }
    return moveBlockSelection(editor, selection, key);
  }

  const ranges = getBlockSelectionRanges(editor, selection);
  return {
    ranges: ranges.map((range) => ({
      row: range.row,
      anchorCol: range.anchorCol,
      focusCol: key === 'ArrowLeft'
        ? getPreviousWordBoundary(range.line, range.focusCol)
        : getNextWordBoundary(range.line, range.focusCol),
    })),
    focusIndex: getBlockSelectionFocusIndex(selection, ranges),
  };
}

function moveBlockCaretsWithCtrl(editor, selection, key) {
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    return moveBlockSelection(editor, selection, key);
  }

  const ranges = getBlockSelectionRanges(editor, selection);
  const lines = splitEditorLines(editor.value);
  return {
    ranges: ranges.map((range) => {
      if (key === 'ArrowLeft' && range.focusCol === 0) {
        const previousRow = Math.max(0, range.row - 1);
        const previousLine = lines[previousRow] || '';
        const previousCol = range.row > 0 ? previousLine.length : 0;
        return {
          row: previousRow,
          anchorCol: previousCol,
          focusCol: previousCol,
        };
      }

      if (key === 'ArrowRight' && range.focusCol >= range.line.length) {
        const nextRow = Math.min(lines.length - 1, range.row + 1);
        const nextCol = range.row < lines.length - 1 ? 0 : range.line.length;
        return {
          row: nextRow,
          anchorCol: nextCol,
          focusCol: nextCol,
        };
      }

      const nextCol = key === 'ArrowLeft'
        ? getPreviousWordBoundary(range.line, range.focusCol)
        : getNextWordBoundary(range.line, range.focusCol);
      return {
        row: range.row,
        anchorCol: nextCol,
        focusCol: nextCol,
      };
    }),
    focusIndex: getBlockSelectionFocusIndex(selection, ranges),
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

function moveBlockSelectionToLineBoundary(editor, selection, key) {
  const ranges = getBlockSelectionRanges(editor, selection);
  if (!ranges.length) return null;

  const nextRanges = ranges.map((range) => ({
    row: range.row,
    anchorCol: range.anchorCol,
    focusCol: key === 'ArrowLeft' ? 0 : range.line.length,
  }));
  const changed = nextRanges.some((range, index) => range.focusCol !== ranges[index].focusCol);
  if (!changed) return null;

  return {
    ranges: nextRanges,
    focusIndex: getBlockSelectionFocusIndex(selection, ranges),
  };
}

function getBlockBounds(editor, selection) {
  const ranges = getBlockSelectionRanges(editor, selection);
  if (!ranges.length) {
    return {
      startRow: 0,
      endRow: 0,
      startCol: 0,
      endCol: 0,
    };
  }
  const startRow = Math.min(...ranges.map((range) => range.row));
  const endRow = Math.max(...ranges.map((range) => range.row));
  const startCol = Math.min(...ranges.map((range) => range.startCol));
  const endCol = Math.max(...ranges.map((range) => range.endCol));
  return { startRow, endRow, startCol, endCol };
}

function getBlockSelectionLineCount(editor, selection) {
  const { startRow, endRow } = getBlockBounds(editor, selection);
  return Math.max(0, endRow - startRow + 1);
}

function renderBlockSelection(editor, overlay, selection, lineHeight) {
  if (!overlay) return;
  overlay.innerHTML = '';
  if (!selection) return;

  const ranges = getBlockSelectionRanges(editor, selection);
  if (!ranges.length) return;
  const style = getComputedStyle(editor);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingTop = parseFloat(style.paddingTop) || 0;

  for (const range of ranges) {
    const rect = document.createElement('div');
    const width = Math.max(2, getEditorColumnsWidth(editor, range.line, range.startCol, range.endCol));
    const left = paddingLeft + getEditorColumnOffset(editor, range.line, range.startCol) - editor.scrollLeft;
    const visual = getEditorVisualLineMetrics(editor, range.row, lineHeight);
    rect.className = 'editor-block-selection-rect';
    rect.style.left = `${left}px`;
    rect.style.top = `${paddingTop + visual.top - editor.scrollTop}px`;
    rect.style.width = `${width}px`;
    rect.style.height = `${visual.height}px`;
    overlay.appendChild(rect);
  }
}

function renderEditorSelectionMatchHighlights(editor, overlay, matches, currentIndex = -1, lineHeight = 20) {
  if (!overlay) return;
  overlay.innerHTML = '';
  if (!matches.length) return;

  const lines = splitEditorLines(editor.value);
  const style = getComputedStyle(editor);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingTop = parseFloat(style.paddingTop) || 0;

  matches.forEach((match, matchIndex) => {
    if (matchIndex === currentIndex) return;
    const start = findLineAndColumnAtPosition(lines, match.start);
    const end = findLineAndColumnAtPosition(lines, match.end);

    for (let row = start.lineIndex; row <= end.lineIndex; row++) {
      const line = lines[row] || '';
      const startCol = row === start.lineIndex ? start.column : 0;
      const endCol = row === end.lineIndex ? end.column : line.length;
      if (startCol === endCol && match.start !== match.end) continue;

      const rect = document.createElement('div');
      const visual = getEditorVisualLineMetrics(editor, row, lineHeight);
      rect.className = 'editor-selection-match-rect';
      rect.style.left = `${paddingLeft + getEditorColumnOffset(editor, line, startCol) - editor.scrollLeft}px`;
      rect.style.top = `${paddingTop + visual.top - editor.scrollTop}px`;
      rect.style.width = `${Math.max(2, getEditorColumnsWidth(editor, line, startCol, endCol))}px`;
      rect.style.height = `${visual.height}px`;
      overlay.appendChild(rect);
    }
  });
}

function getBlockText(editor, selection) {
  return getBlockSelectionRanges(editor, selection)
    .map((range) => editor.value.slice(range.startPos, range.endPos))
    .join('\n');
}

function createCollapsedSelectionFromPositions(text, positions, focusIndex) {
  const lines = splitEditorLines(text);
  return {
    ranges: positions.map((position) => {
      const point = findLineAndColumnAtPosition(lines, position);
      return {
        row: point.lineIndex,
        anchorCol: point.column,
        focusCol: point.column,
      };
    }),
    focusIndex: Math.max(0, Math.min(focusIndex, Math.max(positions.length - 1, 0))),
  };
}

function applyBlockSelectionEdits(editor, selection, buildEdit) {
  const text = editor.value;
  const ranges = getBlockSelectionRanges(editor, selection);
  if (!ranges.length) return null;

  const focusIndex = getBlockSelectionFocusIndex(selection, ranges);
  const caretPositions = [];
  let cursor = 0;
  let changed = false;
  let nextValue = '';

  for (const range of ranges) {
    const edit = buildEdit(range);
    if (!edit) {
      nextValue += text.slice(cursor, range.startPos);
      cursor = range.startPos;
      caretPositions.push(nextValue.length);
      continue;
    }

    const start = Math.max(0, Math.min(text.length, edit.start ?? range.startPos));
    const end = Math.max(start, Math.min(text.length, edit.end ?? range.endPos));
    const replacement = edit.replacement ?? '';
    const caretOffset = edit.caretOffset ?? replacement.length;

    if (start < cursor) return null;

    nextValue += text.slice(cursor, start) + replacement;
    cursor = end;
    caretPositions.push((nextValue.length - replacement.length) + caretOffset);
    if (start !== end || replacement !== text.slice(start, end)) {
      changed = true;
    }
  }

  nextValue += text.slice(cursor);
  if (!changed) return null;

  return {
    value: nextValue,
    selection: createCollapsedSelectionFromPositions(nextValue, caretPositions, focusIndex),
  };
}

function replaceBlockSelectionText(editor, selection, text) {
  return applyBlockSelectionEdits(editor, selection, (range) => ({
    start: range.startPos,
    end: range.endPos,
    replacement: text,
    caretOffset: text.length,
  }));
}

function indentBlockSelection(editor, selection, isShiftTab) {
  return applyBlockSelectionEdits(editor, selection, (range) => {
    if (!isShiftTab) {
      return {
        start: range.startPos,
        end: range.startPos,
        replacement: '  ',
        caretOffset: 2,
      };
    }

    const removableBefore = range.startCol >= 2 && range.line.slice(range.startCol - 2, range.startCol) === '  '
      ? 2
      : range.startCol >= 1 && /[ \t]/.test(range.line[range.startCol - 1])
        ? 1
        : 0;
    if (!removableBefore) return null;
    return {
      start: range.startPos - removableBefore,
      end: range.startPos,
      replacement: '',
      caretOffset: 0,
    };
  });
}

function normalizePastedText(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n');
}

function splitPastedTextLines(text) {
  const lines = normalizePastedText(text).split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function pasteIntoBlockSelection(editor, selection, text) {
  const normalizedText = normalizePastedText(text);
  const ranges = getBlockSelectionRanges(editor, selection);
  const pastedLines = splitPastedTextLines(normalizedText);

  if (ranges.length > 1 && pastedLines.length === ranges.length) {
    return applyBlockSelectionEdits(editor, selection, (range) => {
      const replacement = pastedLines[range.visualIndex] ?? '';
      return {
        start: range.startPos,
        end: range.endPos,
        replacement,
        caretOffset: replacement.length,
      };
    });
  }

  return replaceBlockSelectionText(editor, selection, normalizedText);
}

function insertBlockSelectionNewline(editor, selection) {
  return applyBlockSelectionEdits(editor, selection, (range) => {
    const insertText = `\n${leadingIndent(range.line)}`;
    return {
      start: range.startPos,
      end: range.endPos,
      replacement: insertText,
      caretOffset: insertText.length,
    };
  });
}

function deleteBlockSelectionContent(editor, selection, direction) {
  return applyBlockSelectionEdits(editor, selection, (range) => {
    if (range.startPos !== range.endPos) {
      return {
        start: range.startPos,
        end: range.endPos,
        replacement: '',
        caretOffset: 0,
      };
    }

    if (direction === 'backward') {
      if (range.startPos === 0) return null;
      return {
        start: range.startPos - 1,
        end: range.startPos,
        replacement: '',
        caretOffset: 0,
      };
    }

    if (range.startPos >= editor.value.length) return null;
    return {
      start: range.startPos,
      end: range.startPos + 1,
      replacement: '',
      caretOffset: 0,
    };
  });
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
  const text = getBlockText(editor, selection);
  const result = applyBlockSelectionEdits(editor, selection, (range) => {
    if (range.startPos === range.endPos) return null;
    return {
      start: range.startPos,
      end: range.endPos,
      replacement: '',
      caretOffset: 0,
    };
  });

  if (!result) return false;
  writeClipboard(text);
  editor.value = result.value;
  const focusPoint = getBlockSelectionFocusPoint(editor, result.selection);
  if (!focusPoint) return false;
  const cursor = getPositionFromRowCol(editor, focusPoint.row, focusPoint.col);
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
