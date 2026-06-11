// settings-store — load/save app settings (localStorage; both windows share the origin).

const KEY = 'breathpause.settings';

export const MODES = ['work', 'break'];

function modeDefaults(overrides) {
  return {
    skin: 'orb',
    sizePx: 200,
    opacity: 0.95,
    font: 'Segoe UI',
    labelSize: 16,
    showPhaseLabel: true,
    showPhaseCountdown: true,
    showPomodoro: true,
    showSessions: false,
    fill: '#4FC3F7',
    textColor: '#FFFFFF',
    posRight: 40,               // distance from right edge of primary monitor (px)
    posTop: 40,                 // distance from top edge (px)
    textOffsetX: 0,             // text block horizontal offset (px)
    textOffsetY: 0,             // text block vertical offset (px)
    ...overrides,
  };
}

export const DEFAULT_PATTERNS = [
  {
    id: 'coherent',
    name: 'Coherent',
    phases: [{ type: 'in', seconds: 5.5 }, { type: 'out', seconds: 5.5 }],
  },
  {
    id: 'box',
    name: 'Box breathing',
    phases: [
      { type: 'in', seconds: 4 }, { type: 'hold', seconds: 4 },
      { type: 'out', seconds: 4 }, { type: 'hold', seconds: 4 },
    ],
  },
  {
    id: '478',
    name: '4-7-8',
    phases: [{ type: 'in', seconds: 4 }, { type: 'hold', seconds: 7 }, { type: 'out', seconds: 8 }],
  },
];

export const DEFAULT_SETTINGS = {
  theme: null,     // null = follow OS; 'light' | 'dark' = user override
  timers: {
    workSeconds: 25 * 60,
    breakSeconds: 5 * 60,
    longBreakSeconds: 15 * 60,
    longBreakEvery: 4,
    workPattern: 'coherent',
    breakPattern: '478',
  },
  patterns: DEFAULT_PATTERNS,
  customSkins: [],
  appearance: {
    work:  modeDefaults({ skin: 'orb', fill: '#4FC3F7', sizePx: 200 }),
    break: modeDefaults({ skin: 'sleepy-seal', fill: '#81C784', sizePx: 320 }),
  },
  behavior: {
    autoStart: true,
    startOnBoot: false,
    chimeOnTransitions: false,
  },
  hotkeys: {
    startStop: '',
    pauseResume: '',
    skip: '',
    settings: '',
  },
  text: {
    phases: { in: 'In', out: 'Out', hold: 'Hold' },
    tray: { start: 'Start', pause: 'Pause', resume: 'Resume', settings: 'Settings', exit: 'Exit' },
  },
};

export function modeKey(mode) {
  return mode === 'break' ? 'break' : 'work';
}

export function loadSettings() {
  const base = structuredClone(DEFAULT_SETTINGS);
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && typeof raw === 'object') {
      if (raw.timers && typeof raw.timers === 'object') Object.assign(base.timers, raw.timers);
      if (raw.appearance && typeof raw.appearance === 'object') {
        for (const m of MODES) {
          if (raw.appearance[m] && typeof raw.appearance[m] === 'object') {
            Object.assign(base.appearance[m], raw.appearance[m]);
          }
        }
      }
      if (Array.isArray(raw.patterns) && raw.patterns.length > 0) base.patterns = raw.patterns;
      if (Array.isArray(raw.customSkins)) base.customSkins = raw.customSkins;
      if (raw.behavior && typeof raw.behavior === 'object') Object.assign(base.behavior, raw.behavior);
      if (raw.hotkeys && typeof raw.hotkeys === 'object') Object.assign(base.hotkeys, raw.hotkeys);
      if (raw.theme === 'light' || raw.theme === 'dark') base.theme = raw.theme;
      if (raw.text && typeof raw.text === 'object') {
        if (raw.text.phases && typeof raw.text.phases === 'object') Object.assign(base.text.phases, raw.text.phases);
        if (raw.text.tray && typeof raw.text.tray === 'object') Object.assign(base.text.tray, raw.text.tray);
      }
    }
  } catch { /* corrupted storage -> defaults */ }
  return base;
}

export function saveSettings(s) {
  localStorage.setItem(KEY, JSON.stringify(s));
}
