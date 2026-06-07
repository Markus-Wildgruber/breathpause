// strings — user-facing UI text (tray + break chrome), kept in a SEPARATE file from settings
// so it can be swapped/translated independently. Pure logic, dual-mode.
// Mirrors src/win/core/strings.ps1.

var Strings = (function () {
  function defaults() {
    return {
      version: 1,
      tray: {
        startTimer: 'Start timer',
        stopTimer: 'Stop timer',
        pause: 'Pause',
        resume: 'Resume',
        skip: 'Skip',
        settings: 'Settings',
        exit: 'Exit'
      },
      break: {
        endBreak: 'End break',
        confirmTitle: 'End the break?',
        confirmMessage: 'Return to work now?',
        cancel: 'Cancel'
      }
    };
  }

  // Fill missing/blank keys from defaults so a partial or stale file never leaves a label undefined.
  function normalize(raw) {
    var d = defaults();
    var out = defaults();
    var s = (raw && typeof raw === 'object') ? raw : {};
    ['tray', 'break'].forEach(function (group) {
      var rg = (s[group] && typeof s[group] === 'object') ? s[group] : {};
      Object.keys(d[group]).forEach(function (key) {
        var v = rg[key];
        out[group][key] = (typeof v === 'string' && v.length) ? v : d[group][key];
      });
    });
    return out;
  }

  function parse(jsonString) {
    var raw = null;
    try { raw = JSON.parse(jsonString); } catch (e) { raw = null; }
    return normalize(raw);
  }

  function serialize(strings) {
    return JSON.stringify(normalize(strings), null, 2);
  }

  return { defaults, normalize, parse, serialize };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Strings;
