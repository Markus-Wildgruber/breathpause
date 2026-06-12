// pomodoro — work/break state machine. Pure logic, dual-mode. No timers/Date here:
// the shell calls tick(state, dt) on its own clock so this stays unit-testable (SPEC §5,§11).
//
// State: { running, mode:'work'|'break', remaining, paused, workSeconds, breakSeconds,
//          cyclesCompleted }. Functions are pure: they return a NEW state (and, for tick/skip,
//          the list of events that fired). Event names match SPEC §7.

var Pomodoro = (function () {
  // longBreakEvery N: after every Nth work session the break is a long break (SPEC §5).
  // N <= 0 disables long breaks (every break is short).
  // autoContinue=false: at each boundary the next segment starts PAUSED (wait for Resume)
  // instead of running straight on (SPEC §5).
  function initState(workSeconds, breakSeconds, longBreakSeconds, longBreakEvery, autoContinue) {
    return {
      running: true,            // auto-starts on launch (SPEC §5)
      mode: 'work',
      remaining: workSeconds,
      paused: false,
      workSeconds: workSeconds,
      breakSeconds: breakSeconds,
      longBreakSeconds: (typeof longBreakSeconds === 'number') ? longBreakSeconds : breakSeconds,
      longBreakEvery: (typeof longBreakEvery === 'number') ? longBreakEvery : 0,
      autoContinue: (autoContinue === false) ? false : true,
      breakKind: 'short',       // 'short' | 'long' — kind of the current/last break
      workCount: 0,             // completed work sessions (drives long-break cadence)
      cyclesCompleted: 0        // completed work+break cycles
    };
  }

  function clone(s) {
    return {
      running: s.running, mode: s.mode, remaining: s.remaining, paused: s.paused,
      workSeconds: s.workSeconds, breakSeconds: s.breakSeconds,
      longBreakSeconds: s.longBreakSeconds, longBreakEvery: s.longBreakEvery,
      autoContinue: s.autoContinue,
      breakKind: s.breakKind, workCount: s.workCount, cyclesCompleted: s.cyclesCompleted
    };
  }

  function segmentLength(s, mode) {
    if (mode !== 'break') return s.workSeconds;
    return s.breakKind === 'long' ? s.longBreakSeconds : s.breakSeconds;
  }

  // Apply one segment boundary, mutating `s` and pushing the events it fires.
  function crossBoundary(s, events) {
    if (s.mode === 'work') {
      s.workCount += 1;
      var isLong = s.longBreakEvery > 0 && (s.workCount % s.longBreakEvery === 0);
      s.breakKind = isLong ? 'long' : 'short';
      s.mode = 'break';
      s.remaining = isLong ? s.longBreakSeconds : s.breakSeconds;
      events.push('work_complete', 'break_start');
    } else {
      events.push('break_complete', 'session_start');
      s.cyclesCompleted += 1;
      s.mode = 'work';
      s.remaining = s.workSeconds;
    }
    if (!s.autoContinue) s.paused = true; // wait for the user to Resume the next segment
  }

  // Advance the clock by dt seconds. Carries across multiple boundaries if dt is large.
  function tick(state, dt) {
    var s = clone(state);
    var events = [];
    if (!s.running || s.paused || dt <= 0) return { state: s, events: events };
    var left = dt;
    var guard = 0;
    while (left > 0 && guard < 10000) {
      guard++;
      if (left < s.remaining) {
        s.remaining -= left;
        left = 0;
      } else {
        left -= s.remaining;
        s.remaining = 0;
        crossBoundary(s, events);
        if (s.paused) break; // auto-continue off -> stop here, segment waits for Resume
      }
    }
    return { state: s, events: events };
  }

  function pause(state) {
    var s = clone(state);
    s.paused = true;
    return s;
  }

  function resume(state) {
    var s = clone(state);
    s.paused = false;
    return s;
  }

  // End the current segment immediately and move to the next.
  function skip(state) {
    var s = clone(state);
    var events = [];
    if (s.running) {
      s.remaining = 0;
      crossBoundary(s, events);
    }
    return { state: s, events: events };
  }

  // Re-apply timer config to a running session (used when settings are saved mid-session).
  // Keeps the live countdown, mode, paused flag and counters; only restarts the CURRENT
  // segment's countdown when that segment's own length actually changed. So saving unrelated
  // settings — or changing the break length while working — never resets the work countdown.
  function applyConfig(state, cfg) {
    var s = clone(state);
    var oldLen = segmentLength(s, s.mode);
    if (typeof cfg.workSeconds === 'number') s.workSeconds = cfg.workSeconds;
    if (typeof cfg.breakSeconds === 'number') s.breakSeconds = cfg.breakSeconds;
    if (typeof cfg.longBreakSeconds === 'number') s.longBreakSeconds = cfg.longBreakSeconds;
    if (typeof cfg.longBreakEvery === 'number') s.longBreakEvery = cfg.longBreakEvery;
    if (segmentLength(s, s.mode) !== oldLen) s.remaining = segmentLength(s, s.mode);
    return s;
  }

  // Stop the session -> plain breathing-only bubble (work pattern, no countdown).
  function reset(state) {
    var s = clone(state);
    s.running = false;
    s.paused = false;
    s.mode = 'work';
    s.remaining = s.workSeconds;
    s.breakKind = 'short';
    s.workCount = 0;
    return s;
  }

  // Clamp a per-frame elapsed delta to [0, max]. The shell measures dt from a clock that jumps
  // after sleep; feeding that raw gap to tick() would fast-forward through many boundaries at once,
  // so the frame loop caps it — sleep then effectively pauses the timer. (SPEC §5)
  function limitFrameDt(raw, max) {
    var d = Math.max(0, raw);
    return d > max ? max : d;
  }

  return { initState, segmentLength, tick, pause, resume, skip, reset, applyConfig, limitFrameDt };
})();

export default Pomodoro;
