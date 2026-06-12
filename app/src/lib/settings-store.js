// settings-store — load/save app settings (localStorage; both windows share the origin).

const KEY = 'breathpause.settings';

export const MODES = ['work', 'break'];

function modeDefaults(overrides) {
  return {
    skin: 'orb',
    sizePx: 200,                // work: orb diameter in px (window sizes to fit)
    sizePct: 45,                // break: orb diameter as % of screen height (fullscreen, centered)
    opacity: 0.95,
    font: 'Segoe UI',
    labelSize: 16,             // phase label (big text) size
    subSize: 13,               // pomodoro/sessions (bottom text) size
    showPhaseLabel: true,
    showPhaseCountdown: true,
    showPomodoro: true,
    showSessions: false,
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
  // Per-skin fill color, keyed by skin id. Unset => skin shows as authored (its
  // themeColor anchor). Shared across modes, so a skin keeps its color everywhere.
  skinColors: {},
  appearance: {
    work:  modeDefaults({ skin: 'orb', sizePx: 200 }),
    break: modeDefaults({ skin: 'sleepy-seal', sizePx: 320 }),
  },
  behavior: {
    autoStart: true,
    startOnBoot: false,
    chimeOnTransitions: false,
  },
  // Global (OS-registered) hotkeys. Ctrl+Alt+Shift+<key>: practically never taken by
  // other apps, and unlike plain Ctrl+Alt it can't collide with AltGr characters on
  // European layouts. Empty string = hotkey disabled.
  hotkeys: {
    startStop: 'Ctrl+Alt+Shift+S',
    pauseResume: 'Ctrl+Alt+Shift+P',
    skip: 'Ctrl+Alt+Shift+N',
    settings: 'Ctrl+Alt+Shift+O',
    hide: 'Ctrl+Alt+Shift+H',
  },
  text: {
    phases: { in: 'In', out: 'Out', hold: 'Hold' },
    tray: { start: 'Start', pause: 'Pause', resume: 'Resume', settings: 'Settings', exit: 'Exit' },
  },
};

export function modeKey(mode) {
  return mode === 'break' ? 'break' : 'work';
}

// Apply a pattern-editor result to a (patterns, timers) pair, returning new copies.
// A result is either a saved pattern (append when its id is new, replace when it exists)
// or { id, deleted: true } (drop it and re-point any work/break selection that used it).
// Pure + returns fresh arrays so the caller can assign reactively and persist.
export function applyPatternResult(patterns, timers, result) {
  const out = { patterns: (patterns || []).slice(), timers: { ...timers } };
  if (!result || !result.id) return out;
  if (result.deleted) {
    out.patterns = out.patterns.filter((p) => p.id !== result.id);
    if (out.timers.workPattern === result.id) out.timers.workPattern = out.patterns[0]?.id ?? '';
    if (out.timers.breakPattern === result.id) out.timers.breakPattern = out.patterns[0]?.id ?? '';
    return out;
  }
  const idx = out.patterns.findIndex((p) => p.id === result.id);
  if (idx >= 0) out.patterns[idx] = result;
  else out.patterns.push(result);
  return out;
}

// A collision-proof id for an imported skin. Date.now() alone collides when the same SVG
// is imported twice quickly, which crashes the keyed skin list (each_key_duplicate).
export function newSkinId() {
  const rand = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return 'custom-' + rand;
}

// Deep-merge a partial settings patch in place: objects merge, everything else
// (numbers, strings, arrays) replaces. Used by the --apply-settings launch hook.
export function mergePatch(base, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      mergePatch(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
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
      if (Array.isArray(raw.customSkins)) {
        // Guarantee well-formed, unique ids: a duplicate/missing id crashes the keyed
        // skin list (Svelte each_key_duplicate). Drop entries with no SVG.
        const seen = new Set();
        base.customSkins = raw.customSkins
          .filter(cs => cs && typeof cs === 'object' && typeof cs.svgText === 'string')
          .map((cs, i) => {
            let id = cs.id || `custom-${i}`;
            while (seen.has(id)) id += `-${i}`;
            seen.add(id);
            return { ...cs, id };
          });
      }
      if (raw.skinColors && typeof raw.skinColors === 'object') Object.assign(base.skinColors, raw.skinColors);
      if (raw.behavior && typeof raw.behavior === 'object') Object.assign(base.behavior, raw.behavior);
      if (raw.hotkeys && typeof raw.hotkeys === 'object') {
        // '' = never configured (hotkeys predate their implementation) -> keep the
        // default. null = explicitly disabled via the clear button -> stays off.
        for (const [k, v] of Object.entries(raw.hotkeys)) {
          if (v === null) base.hotkeys[k] = '';
          else if (typeof v === 'string' && v) base.hotkeys[k] = v;
        }
      }
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
