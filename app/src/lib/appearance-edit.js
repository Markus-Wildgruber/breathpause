// appearance-edit — the ranges and setters shared by the bubble's edit mode (App.svelte) and the
// settings window (Settings.svelte), so both write the same settings keys the same way.

export const BUBBLE_RANGE = [60, 480];                        // appearance.work.sizePx
// Text lines: 'label' = phase line, 'sub' = pomodoro line; keys are labelSize/subSize etc.
export const SIZE_RANGE = { label: [10, 32], sub: [6, 24] };
// The two parts of each line that can be shown/hidden.
export const LINE_PARTS = {
  label: [['showPhaseLabel', 'Phase'], ['showPhaseCountdown', 'Count']],
  sub: [['showPomodoro', 'Timer'], ['showSessions', 'Sessions']],
};

// How far a line may be moved from its place (px), so it stays inside the bubble window.
export function lineOffsetRange(ap) {
  const half = Math.round(ap.sizePx / 2);
  return { x: [-half, half], y: [-ap.sizePx, 48] };
}

// The color a text line shows when it has none of its own: the shared text color, else the skin's.
export const baseTextColor = (ap, skin) => ap.textColor || skin?.manifest.text?.color || '#eef6ff';

// Per-skin bubble color; '' = back to the skin as authored.
export function setSkinColor(settings, skinId, color) {
  if (color) settings.skinColors[skinId] = color;
  else delete settings.skinColors[skinId];
}

// A text line's own color; '' = back to the shared default text color.
export function setLineColor(ap, line, color) {
  ap[line + 'Color'] = color;
}

// A typed color: '#abc' / 'abc' / '#aabbcc' -> '#AABBCC'; anything else (also half-typed) -> null.
export function parseHex(text) {
  const m = String(text).trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  return '#' + (m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]).toUpperCase();
}
