// shell/sound — transition chime. JXA/Cocoa. (SPEC §5)
// ⚠️ UNVERIFIED SCAFFOLDING — written without a Mac; debug on-device.

var Sound = (function () {
  // Plays a soft built-in system sound when sound is enabled. No bundled asset (SPEC §10).
  function playChime(enabled) {
    if (!enabled) return;
    try {
      var snd = $.NSSound.alloc.initWithContentsOfFileByReference(
        '/System/Library/Sounds/Submarine.aiff', true);
      if (snd && !snd.isNil()) snd.play();
    } catch (e) { /* non-fatal */ }
  }
  return { playChime };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Sound;
