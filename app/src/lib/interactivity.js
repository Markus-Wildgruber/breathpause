// interactivity — click-through bubble with hover-to-grab.
//
// Default: the window ignores all mouse input (clicks land on whatever is underneath).
// A poller watches the global cursor; after dwelling over the bubble for `dwellMs`
// the window turns interactive: cursor switches (body.hot) and a left-press anywhere
// starts dragging the window. Leaving the bubble reverts to click-through.
//
// During a break the bubble goes fullscreen and must be fully interactive (exit button),
// so the poller can be paused via setHoverDragActive(false) — which also drops
// click-through. Switching back to work re-arms click-through.

let _win = null;
let hoverActive = true;   // false while the break overlay owns the screen
let hot = false;          // module-scoped: shared by the poller, the drag handler, and pausing

export async function setHoverDragActive(active) {
  hoverActive = active;
  if (!_win) return;
  hot = false;
  document.body.classList.remove('hot');
  // active   -> work bubble: click-through until the cursor dwells on it again
  // inactive -> break overlay: fully interactive so the exit button is clickable
  await _win.setIgnoreCursorEvents(active);
}

export async function setupHoverDrag({ dwellMs = 1000, leaveMs = 400, pollMs = 120 } = {}) {
  if (!('__TAURI_INTERNALS__' in window)) return;   // browser dev: stay fully interactive
  const { getCurrentWindow, cursorPosition } = await import('@tauri-apps/api/window');
  _win = getCurrentWindow();

  await _win.setIgnoreCursorEvents(true);

  let dwellStart = 0;
  let lastInside = 0;

  // Detect double-click by timing: once startDragging() runs the OS owns the move-loop
  // and the DOM 'dblclick' never fires, so we time consecutive mousedowns ourselves.
  let lastDown = 0;
  window.addEventListener('mousedown', (e) => {
    if (!hot || e.button !== 0) return;
    const now = Date.now();
    if (now - lastDown < 350) {
      lastDown = 0;
      import('@tauri-apps/api/event').then(({ emit }) => emit('open-settings'));
      return;
    }
    lastDown = now;
    _win.startDragging();
  });

  setInterval(async () => {
    if (!hoverActive) return;   // paused while the break overlay is up
    try {
      const [cur, pos, size] = await Promise.all([
        cursorPosition(), _win.outerPosition(), _win.outerSize(),
      ]);
      const inside =
        cur.x >= pos.x && cur.x < pos.x + size.width &&
        cur.y >= pos.y && cur.y < pos.y + size.height;
      const now = Date.now();

      if (inside) {
        lastInside = now;
        if (!hot) {
          if (!dwellStart) dwellStart = now;
          if (now - dwellStart >= dwellMs) {
            hot = true;
            document.body.classList.add('hot');
            await _win.setIgnoreCursorEvents(false);
          }
        }
      } else {
        dwellStart = 0;
        if (hot && now - lastInside > leaveMs) {
          hot = false;
          document.body.classList.remove('hot');
          await _win.setIgnoreCursorEvents(true);
        }
      }
    } catch (e) {
      console.warn('hover poll failed:', e);
    }
  }, pollMs);
}
