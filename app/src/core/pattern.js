// pattern — convert a stored settings pattern into the engine pattern that breathing.js
// consumes. Settings store phases as in/out/hold; the breathing engine wants
// inhale/exhale/hold and a display label per phase. This is the seam between the two,
// kept pure so it can be tested without a component.

const TYPE_MAP = { in: 'inhale', out: 'exhale', hold: 'hold' };
const DEFAULT_LABELS = { in: 'breathe in', out: 'breathe out', hold: 'hold' };

// Used when no pattern can be resolved at all (no patterns configured).
function defaultPattern() {
  return {
    phases: [
      { type: 'inhale', seconds: 5.5, label: 'breathe in' },
      { type: 'exhale', seconds: 5.5, label: 'breathe out' },
    ],
  };
}

function toEnginePattern(settings, mode) {
  const patternId = mode === 'work' ? settings.timers?.workPattern : settings.timers?.breakPattern;
  const patterns = settings.patterns || [];
  const sp = patterns.find(p => p.id === patternId) || patterns[0];
  if (!sp) return defaultPattern();

  const labels = settings.text?.phases || DEFAULT_LABELS;
  return {
    phases: sp.phases.map(ph => ({
      type: TYPE_MAP[ph.type] || 'hold',
      seconds: ph.seconds,
      label: labels[ph.type] || ph.type,
    })),
  };
}

export default { toEnginePattern };
