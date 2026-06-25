function attachStructuredShortcuts(host, handlers) {
  const listener = (event) => {
    if (!document.body.contains(host)) {
      document.removeEventListener('keydown', listener);
      return;
    }
    if (!event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 's') {
      event.preventDefault();
      saveFile();
    } else if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      handlers.undo?.();
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      handlers.redo?.();
    }
  };
  document.addEventListener('keydown', listener);
}

function attachWheelZoom(host, scrollEl, zoom) {
  host.addEventListener('wheel', (event) => {
    if (!event.altKey) return;
    event.preventDefault();
    zoom(event.deltaY);
  }, { passive: false });
}

function attachMiddlePan(scrollEl) {
  scrollEl.addEventListener('mousedown', (event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = scrollEl.scrollLeft;
    const startTop = scrollEl.scrollTop;
    scrollEl.classList.add('is-middle-panning');
    const move = (moveEvent) => {
      scrollEl.scrollLeft = startLeft - (moveEvent.clientX - startX);
      scrollEl.scrollTop = startTop - (moveEvent.clientY - startY);
    };
    const up = () => {
      scrollEl.classList.remove('is-middle-panning');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}
