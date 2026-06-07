// hotkeys - parse a hotkey string ("Ctrl+Alt+P") into modifier VKs + a key VK. Pure logic.
// A modifier is required; bare keys / empty strings return null. Mirrors src/win/core/hotkeys.ps1.
// (macOS runtime hotkeys aren't wired yet; this exists for parity + tests.)

var Hotkeys = (function () {
  function toVk(k) {
    var u = ('' + k).trim().toUpperCase();
    if (u.length === 1 && /^[A-Z0-9]$/.test(u)) return u.charCodeAt(0); // A-Z 0x41-5A, 0-9 0x30-39
    var m = u.match(/^F([1-9]|1[0-2])$/);
    if (m) return 0x70 + (parseInt(m[1], 10) - 1);                      // F1-F12
    return null;
  }

  function parse(s) {
    if (!s) return null;
    var mods = [], vk = null;
    var parts = ('' + s).split('+');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim().toLowerCase();
      if (p === 'ctrl' || p === 'control') mods.push(0x11);
      else if (p === 'alt') mods.push(0x12);
      else if (p === 'shift') mods.push(0x10);
      else if (p === 'win') mods.push(0x5B);
      else vk = toVk(parts[i]);
    }
    if (vk == null || mods.length === 0) return null; // require a key AND >=1 modifier
    return { mods, vk, down: false };
  }

  return { toVk, parse };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Hotkeys;
