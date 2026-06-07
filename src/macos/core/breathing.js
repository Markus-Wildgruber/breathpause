// breathing — phase schedule + eased bubble size over time. Pure logic, dual-mode.
//
// A pattern is { phases: [ { type: 'inhale'|'exhale'|'hold', seconds, label }, ... ] }.
// Size is normalized 0 (collapsed) .. 1 (expanded). inhale ramps toward 1, exhale toward
// 0, hold keeps the size it inherits from the preceding phase. The pattern loops, so the
// start-of-cycle size is made continuous with the end-of-cycle size (SPEC §2).

var Breathing = (function () {
  function easeInOut(p) {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    return (1 - Math.cos(Math.PI * p)) / 2; // cosine ease-in-out
  }

  function cycleDuration(pattern) {
    var total = 0;
    var phases = (pattern && pattern.phases) || [];
    for (var i = 0; i < phases.length; i++) total += Math.max(0, phases[i].seconds || 0);
    return total;
  }

  // Target size a phase drives toward, given the size it starts from.
  function phaseTarget(type, startSize) {
    if (type === 'inhale') return 1;
    if (type === 'exhale') return 0;
    return startSize; // hold
  }

  // Boundary sizes b[0..n]: b[i] is the size at the start of phase i, b[n] the cycle end.
  // Two passes make b[0] === b[n] for seamless looping (handles leading holds; all-hold
  // patterns settle to 0).
  function boundarySizes(pattern) {
    var phases = (pattern && pattern.phases) || [];
    var n = phases.length;
    function walk(start) {
      var b = [start];
      for (var i = 0; i < n; i++) b.push(phaseTarget(phases[i].type, b[i]));
      return b;
    }
    var first = walk(0);
    return walk(first[n]); // seed start with first pass's end for continuity
  }

  // Locate the phase active at time t within one cycle.
  function phaseAt(pattern, t) {
    var phases = (pattern && pattern.phases) || [];
    var dur = cycleDuration(pattern);
    if (dur <= 0 || phases.length === 0) return null;
    var tc = ((t % dur) + dur) % dur; // wrap into [0, dur)
    var acc = 0;
    for (var i = 0; i < phases.length; i++) {
      var len = Math.max(0, phases[i].seconds || 0);
      if (tc < acc + len || i === phases.length - 1) {
        var elapsed = tc - acc;
        return {
          index: i,
          phase: phases[i],
          elapsed: elapsed,
          remaining: Math.max(0, len - elapsed),
          progress: len > 0 ? Math.min(1, elapsed / len) : 1
        };
      }
      acc += len;
    }
    return null;
  }

  // Normalized size 0..1 at time t.
  function sizeAt(pattern, t) {
    var info = phaseAt(pattern, t);
    if (!info) return 0;
    var b = boundarySizes(pattern);
    var from = b[info.index];
    var type = info.phase.type;
    if (type === 'hold') return from;
    var to = phaseTarget(type, from);
    return from + (to - from) * easeInOut(info.progress);
  }

  // Map normalized size to a pixel diameter.
  function diameterForSize(size, collapsedPx, expandedPx) {
    return collapsedPx + size * (expandedPx - collapsedPx);
  }

  function currentLabel(pattern, t) {
    var info = phaseAt(pattern, t);
    return info ? (info.phase.label != null ? info.phase.label : '') : '';
  }

  return { easeInOut, cycleDuration, boundarySizes, phaseAt, sizeAt, diameterForSize, currentLabel };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Breathing;
