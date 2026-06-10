// settings-store — load/save app settings (localStorage; both windows share the origin).
// Schema is the fresh start decided for the Tauri port. Durations in seconds.

const KEY = 'breathpause.settings';

export const DEFAULT_SETTINGS = {
  timers: {
    workSeconds: 25 * 60,
    breakSeconds: 5 * 60,
    longBreakSeconds: 15 * 60,
    longBreakEvery: 4,          // 0 = off
    autoContinue: true,
  },
  appearance: {
    opacity: 0.95,              // 0..1
    collapsedPx: 80,
    expandedPx: 200,
    breakPct: 40,               // break size, % of screen height
    font: 'Segoe UI',
    labelSize: 16,
    showPhaseLabel: true,
    showPhaseCountdown: true,
    showPomodoro: true,
    showSessions: false,
    workFill: '#4FC3F7',
    breakFill: '#81C784',
    textColor: '#FFFFFF',
  },
  skins: { work: 'orb', break: 'sleepy-seal', longBreak: 'sleepy-seal' },
};

export function loadSettings() {
  const base = structuredClone(DEFAULT_SETTINGS);
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && typeof raw === 'object') {
      for (const section of Object.keys(base)) {
        if (raw[section] && typeof raw[section] === 'object') {
          Object.assign(base[section], raw[section]);
        }
      }
    }
  } catch { /* corrupted storage -> defaults */ }
  return base;
}

export function saveSettings(s) {
  localStorage.setItem(KEY, JSON.stringify(s));
}
