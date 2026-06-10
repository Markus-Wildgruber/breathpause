// interactivity — click-through bubble with hover-to-grab.
//
// Default: the window ignores all mouse input (clicks land on whatever is underneath).
// A poller watches the global cursor; after dwelling over the bubble for `dwellMs`
// the window turns interactive: cursor switches (body.hot) and a left-press anywhere
// starts dragging the window. Leaving the bubble reverts to click-through.

export async function setupHoverDrag({ dwellMs = 1600, leaveMs = 400, pollMs = 120 } = {}) {
  if (!('__TAURI_INTERNALS__' in window)) return;   // browser dev: stay fully interactive
  const { getCurrentWindow, cursorPosition } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();

  await win.setIgnoreCursorEvents(true);

  let hot = false;
  let dwellStart = 0;
  let lastInside = 0;

  window.addEventListener('mousedown', (e) => {
    if (hot && e.button === 0) win.startDragging();
  });

  setInterval(async () => {
    try {
      const [cur, pos, size] = await Promise.all([
        cursorPosition(), win.outerPosition(), win.outerSize(),
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
            await win.setIgnoreCursorEvents(false);
          }
        }
      } else {
        dwellStart = 0;
        if (hot && now - lastInside > leaveMs) {
          hot = false;
          document.body.classList.remove('hot');
          await win.setIgnoreCursorEvents(true);
        }
      }
    } catch (e) {
      console.warn('hover poll failed:', e);
    }
  }, pollMs);
}
