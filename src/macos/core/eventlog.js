// eventlog — format records for events.log (JSON Lines). Pure logic, dual-mode.
// The shell supplies the timestamp (ISO-8601) and appends serialize()+"\n" to the file.

var Eventlog = (function () {
  var EVENTS = [
    'session_start', 'work_complete', 'break_start', 'break_complete',
    'pause', 'resume', 'skip', 'reset', 'quit'
  ];

  function isValidEvent(name) {
    return EVENTS.indexOf(name) !== -1;
  }

  // Build one log record. `ts` is an ISO-8601 string (caller-provided). `extra` is merged in.
  function makeEvent(name, ts, extra) {
    var rec = { ts: ts, event: name };
    if (extra && typeof extra === 'object') {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k) && k !== 'ts' && k !== 'event') {
          rec[k] = extra[k];
        }
      }
    }
    return rec;
  }

  // One JSONL line (no trailing newline; the writer adds it).
  function serialize(rec) {
    return JSON.stringify(rec);
  }

  return { EVENTS, isValidEvent, makeEvent, serialize };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Eventlog;
