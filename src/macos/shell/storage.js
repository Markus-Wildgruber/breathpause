// shell/storage — settings.json + events.log under Application Support (SPEC §7). JXA file I/O.
// ⚠️ UNVERIFIED SCAFFOLDING — written without a Mac; debug on-device.
//   Config dir: ~/Library/Application Support/breathpause/  (settings.json, events.log)
// First shell module in the bundle, so it imports the frameworks the other shells need.

ObjC.import('Cocoa');
ObjC.import('QuartzCore');

var Storage = (function () {
  function fm() { return $.NSFileManager.defaultManager; }
  function dir() { return $.NSHomeDirectory().js + '/Library/Application Support/breathpause'; }
  function ensureDir() {
    fm().createDirectoryAtPathWithIntermediateDirectoriesAttributesError(dir(), true, null, null);
  }
  function readSettings() {
    ensureDir();
    var s = $.NSString.stringWithContentsOfFileEncodingError(dir() + '/settings.json', $.NSUTF8StringEncoding, null);
    return (s && !s.isNil()) ? Settings.parse(s.js) : Settings.defaults();
  }
  function writeSettings(settings) {
    ensureDir();
    $(Settings.serialize(settings)).writeToFileAtomicallyEncodingError(
      dir() + '/settings.json', true, $.NSUTF8StringEncoding, null);
  }
  // User-facing UI text lives in its own file (strings.json) so it can be translated/swapped
  // independently of settings.json. Mirrors the Windows Read/Write-AppStrings.
  function readStrings() {
    ensureDir();
    var s = $.NSString.stringWithContentsOfFileEncodingError(dir() + '/strings.json', $.NSUTF8StringEncoding, null);
    return (s && !s.isNil()) ? Strings.parse(s.js) : Strings.defaults();
  }
  function writeStrings(strings) {
    ensureDir();
    $(Strings.serialize(strings)).writeToFileAtomicallyEncodingError(
      dir() + '/strings.json', true, $.NSUTF8StringEncoding, null);
  }
  // Append one JSON-Lines record to events.log (SPEC §7).
  function appendEvent(name, extra) {
    ensureDir();
    var ts = $.NSISO8601DateFormatter.alloc.init.stringFromDate($.NSDate.date).js;
    var line = Eventlog.serialize(Eventlog.makeEvent(name, ts, extra)) + '\n';
    var path = dir() + '/events.log';
    var h = $.NSFileHandle.fileHandleForWritingAtPath(path);
    if (h && !h.isNil()) {
      h.seekToEndOfFile; h.writeData($(line).dataUsingEncoding($.NSUTF8StringEncoding)); h.closeFile;
    } else {
      $(line).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
    }
  }
  return { readSettings, writeSettings, readStrings, writeStrings, appendEvent };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Storage;
