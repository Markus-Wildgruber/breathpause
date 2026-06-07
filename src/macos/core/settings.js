// settings — schema defaults, normalize/validate, pattern resolution. Pure logic, dual-mode.
// Mirrors the shared JSON schema (SPEC §8). File I/O lives in the shell; this module only
// turns strings <-> normalized objects.

var Settings = (function () {
  // Cross-module dep: under Node use require(); in the concatenated bundle use the global
  // Timefmt namespace (defined earlier). The untaken ternary branch is never evaluated, so
  // neither environment hits an undefined reference.
  var TF = (typeof require !== 'undefined') ? require('./timefmt') : Timefmt;

  var PHASE_TYPES = ['inhale', 'exhale', 'hold'];

  // App release version (distinct from the settings-schema `version` field). Keep in sync with
  // src/win/core/settings.ps1 Get-AppVersion.
  function appVersion() { return '0.1.0'; }

  function defaults() {
    return {
      version: 1,
      patterns: [
        { id: 'coherent-5-5', name: '5.5 In / 5.5 Out', phases: [
          { type: 'inhale', seconds: 5.5, label: 'In' },
          { type: 'exhale', seconds: 5.5, label: 'Out' }
        ] }
      ],
      workPatternId: 'coherent-5-5',
      breakPatternId: 'coherent-5-5',
      longBreakPatternId: 'coherent-5-5',
      timers: { work: '00:25', break: '05:00', longBreak: '15:00' }, // hh:mm / mm:ss / mm:ss
      cycle: { mode: 'loop-forever', longBreakEvery: 4, autoContinue: true }, // longBreakEvery 0 = off; autoContinue false = wait for Resume each segment
      appearance: {
        collapsedDiameterPx: 80,
        expandedDiameterPx: 200,
        opacity: 0.20,
        breakSizePctScreenHeight: 40,
        easing: 'ease-in-out',
        showLabel: true,
        showPhaseCountdown: true,
        showRemainingTimeUnderBubble: true,
        font: { family: 'Segoe UI Variable', size: 16, countdownSize: 13, pomodoroSize: 12 },
        colors: {
          workFill: '#4FC3F7', breakFill: '#81C784', text: '#FFFFFF', breakOverlayTint: '#000000CC'
        }
      },
      position: { fromRight: 16, fromTop: 16 }, // orb top-right corner, px from the screen's top-right
      behavior: { autoStartTimerOnLaunch: true, singleInstance: true, startOnBoot: false },
      hotkeys: { startStop: '', pauseResume: '', skip: '', settings: '' }, // '' = disabled
      sound: { enabled: true }
    };
  }

  function clampNum(v, lo, hi, dflt) {
    if (typeof v !== 'number' || isNaN(v)) return dflt;
    return Math.min(hi, Math.max(lo, v));
  }

  function isHexColor(v) {
    return typeof v === 'string' && /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v);
  }

  // A pattern is valid if it has >=1 phase, each a known type with seconds in [0.1, 60].
  function validatePattern(p) {
    if (!p || typeof p.id !== 'string' || !Array.isArray(p.phases) || p.phases.length === 0) return false;
    for (var i = 0; i < p.phases.length; i++) {
      var ph = p.phases[i];
      if (!ph || PHASE_TYPES.indexOf(ph.type) === -1) return false;
      if (typeof ph.seconds !== 'number' || ph.seconds < 0.1 || ph.seconds > 60) return false;
    }
    return true;
  }

  // Fill missing fields from defaults and clamp out-of-range values. Always returns a
  // complete, safe settings object; invalid patterns are dropped (defaults kept if none remain).
  function normalize(raw) {
    var d = defaults();
    var s = (raw && typeof raw === 'object') ? raw : {};
    var out = defaults();

    if (Array.isArray(s.patterns)) {
      var kept = s.patterns.filter(validatePattern);
      if (kept.length) out.patterns = kept;
    }
    var ids = out.patterns.map(function (p) { return p.id; });
    out.workPatternId = ids.indexOf(s.workPatternId) !== -1 ? s.workPatternId : out.patterns[0].id;
    out.breakPatternId = ids.indexOf(s.breakPatternId) !== -1 ? s.breakPatternId : out.patterns[0].id;
    out.longBreakPatternId = ids.indexOf(s.longBreakPatternId) !== -1 ? s.longBreakPatternId : out.breakPatternId;

    var t = (s.timers && typeof s.timers === 'object') ? s.timers : {};
    out.timers.work = TF.parseWorkSeconds(t.work) != null ? t.work : d.timers.work;
    out.timers.break = TF.parseBreakSeconds(t.break) != null ? t.break : d.timers.break;
    out.timers.longBreak = TF.parseBreakSeconds(t.longBreak) != null ? t.longBreak : d.timers.longBreak;

    var cy = (s.cycle && typeof s.cycle === 'object') ? s.cycle : {};
    out.cycle.longBreakEvery = (typeof cy.longBreakEvery === 'number' && cy.longBreakEvery >= 0)
      ? Math.min(99, Math.floor(cy.longBreakEvery)) : d.cycle.longBreakEvery;
    out.cycle.autoContinue = typeof cy.autoContinue === 'boolean' ? cy.autoContinue : d.cycle.autoContinue;

    var a = (s.appearance && typeof s.appearance === 'object') ? s.appearance : {};
    var oa = out.appearance;
    oa.collapsedDiameterPx = clampNum(a.collapsedDiameterPx, 8, 2000, d.appearance.collapsedDiameterPx);
    oa.expandedDiameterPx = clampNum(a.expandedDiameterPx, 8, 4000, d.appearance.expandedDiameterPx);
    if (oa.expandedDiameterPx < oa.collapsedDiameterPx) oa.expandedDiameterPx = oa.collapsedDiameterPx;
    oa.opacity = clampNum(a.opacity, 0.05, 1, d.appearance.opacity);
    oa.breakSizePctScreenHeight = clampNum(a.breakSizePctScreenHeight, 5, 100, d.appearance.breakSizePctScreenHeight);
    oa.showLabel = typeof a.showLabel === 'boolean' ? a.showLabel : d.appearance.showLabel;
    oa.showPhaseCountdown = typeof a.showPhaseCountdown === 'boolean' ? a.showPhaseCountdown : d.appearance.showPhaseCountdown;
    oa.showRemainingTimeUnderBubble = typeof a.showRemainingTimeUnderBubble === 'boolean' ? a.showRemainingTimeUnderBubble : d.appearance.showRemainingTimeUnderBubble;
    var f = (a.font && typeof a.font === 'object') ? a.font : {};
    oa.font.family = (typeof f.family === 'string' && f.family.length) ? f.family : d.appearance.font.family;
    oa.font.size = clampNum(f.size, 8, 72, d.appearance.font.size);
    // Per-text sizes: countdown/pomodoro. Missing values migrate from the (single) legacy size.
    oa.font.countdownSize = clampNum(f.countdownSize, 8, 72, Math.round(oa.font.size * 0.8));
    oa.font.pomodoroSize = clampNum(f.pomodoroSize, 8, 72, Math.round(oa.font.size * 0.72));
    var c = (a.colors && typeof a.colors === 'object') ? a.colors : {};
    ['workFill', 'breakFill', 'text', 'breakOverlayTint'].forEach(function (k) {
      oa.colors[k] = isHexColor(c[k]) ? c[k] : d.appearance.colors[k];
    });

    var p = (s.position && typeof s.position === 'object') ? s.position : {};
    out.position.fromRight = (typeof p.fromRight === 'number') ? Math.max(0, p.fromRight) : d.position.fromRight;
    out.position.fromTop = (typeof p.fromTop === 'number') ? Math.max(0, p.fromTop) : d.position.fromTop;

    var b = (s.behavior && typeof s.behavior === 'object') ? s.behavior : {};
    out.behavior.autoStartTimerOnLaunch = typeof b.autoStartTimerOnLaunch === 'boolean' ? b.autoStartTimerOnLaunch : d.behavior.autoStartTimerOnLaunch;
    out.behavior.singleInstance = typeof b.singleInstance === 'boolean' ? b.singleInstance : d.behavior.singleInstance;
    out.behavior.startOnBoot = typeof b.startOnBoot === 'boolean' ? b.startOnBoot : d.behavior.startOnBoot;

    var hk = (s.hotkeys && typeof s.hotkeys === 'object') ? s.hotkeys : {};
    ['startStop', 'pauseResume', 'skip', 'settings'].forEach(function (k) {
      out.hotkeys[k] = (typeof hk[k] === 'string') ? hk[k] : d.hotkeys[k];
    });

    var snd = (s.sound && typeof s.sound === 'object') ? s.sound : {};
    out.sound.enabled = typeof snd.enabled === 'boolean' ? snd.enabled : d.sound.enabled;

    return out;
  }

  function findPattern(settings, id) {
    var ps = (settings && settings.patterns) || [];
    for (var i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i];
    return null;
  }

  function getWorkPattern(settings) {
    return findPattern(settings, settings.workPatternId) || settings.patterns[0];
  }

  function getBreakPattern(settings) {
    return findPattern(settings, settings.breakPatternId) || settings.patterns[0];
  }

  // Parse a JSON string into a normalized settings object; falls back to defaults on bad JSON.
  function parse(jsonString) {
    var raw;
    try { raw = JSON.parse(jsonString); } catch (e) { raw = null; }
    return normalize(raw);
  }

  function serialize(settings) {
    return JSON.stringify(normalize(settings), null, 2);
  }

  return {
    defaults, normalize, validatePattern, findPattern, getWorkPattern, getBreakPattern,
    parse, serialize, isHexColor, appVersion, PHASE_TYPES
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Settings;
