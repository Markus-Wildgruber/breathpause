// timefmt — parse / format / validate clock strings. Pure logic, dual-mode (Node + JXA).
//
// Work timer is "hh:mm" (00:01–99:59). Break timer is "mm:ss" (00:01–59:59).
// Parse functions return a non-negative integer of seconds, or null when invalid
// (caller treats null as "reject with a gentle message" per SPEC §5).
//
// Wrapped in a namespace IIFE so that, when the build concatenates every module into one
// bundle scope, top-level helper names never collide across modules (SPEC §11).

var Timefmt = (function () {
  function parseTwoPart(str) {
    if (typeof str !== 'string') return null;
    var m = str.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return { a: parseInt(m[1], 10), b: parseInt(m[2], 10) };
  }

  // "hh:mm" -> seconds. hh 0–99, mm 0–59, total >= 60s (00:01). NB hh:mm, so 25 min = "00:25".
  function parseWorkSeconds(str) {
    var p = parseTwoPart(str);
    if (!p) return null;
    if (p.a < 0 || p.a > 99 || p.b < 0 || p.b > 59) return null;
    var s = p.a * 3600 + p.b * 60;
    return s >= 60 ? s : null;
  }

  // "mm:ss" -> seconds. mm 0–59, ss 0–59, total >= 1s (00:01).
  function parseBreakSeconds(str) {
    var p = parseTwoPart(str);
    if (!p) return null;
    if (p.a < 0 || p.a > 59 || p.b < 0 || p.b > 59) return null;
    var s = p.a * 60 + p.b;
    return s >= 1 ? s : null;
  }

  function pad2(n) {
    n = Math.floor(n);
    return (n < 10 ? '0' : '') + n;
  }

  // Remaining time for display: "MM:SS" under an hour, "H:MM:SS" at/over an hour.
  function formatRemaining(totalSeconds) {
    totalSeconds = Math.max(0, Math.floor(totalSeconds));
    var h = Math.floor(totalSeconds / 3600);
    var m = Math.floor((totalSeconds % 3600) / 60);
    var s = totalSeconds % 60;
    return h > 0 ? h + ':' + pad2(m) + ':' + pad2(s) : pad2(m) + ':' + pad2(s);
  }

  return { parseTwoPart, parseWorkSeconds, parseBreakSeconds, pad2, formatRemaining };
})();

export default Timefmt;
