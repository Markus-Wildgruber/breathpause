// Save and restore window position across sessions.
// Uses physical pixels (Tauri native units) and validates against all currently
// connected monitors — if the saved spot is off-screen, falls back to center.

const PREFIX = 'breathpause.winPos.';

export async function restoreWindowPosition(key, win) {
  const { availableMonitors, PhysicalPosition } = await import('@tauri-apps/api/window');
  const raw = localStorage.getItem(PREFIX + key);
  if (raw) {
    try {
      const { x, y } = JSON.parse(raw);
      const monitors = await availableMonitors();
      // Accept if the top-left corner lands within any monitor (with small margin)
      const onScreen = monitors.some(m =>
        x >= m.position.x - 50 &&
        x <  m.position.x + m.size.width  - 100 &&
        y >= m.position.y &&
        y <  m.position.y + m.size.height - 50
      );
      if (onScreen) {
        await win.setPosition(new PhysicalPosition(x, y));
        return;
      }
    } catch {}
  }
  await win.center();
}

export async function trackWindowPosition(key, win) {
  let saveTimer;
  return win.onMoved(({ payload: { x, y } }) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      localStorage.setItem(PREFIX + key, JSON.stringify({ x, y }));
    }, 250);
  });
}
