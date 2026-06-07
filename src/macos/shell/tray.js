// shell/tray — menu-bar status item + menu. JXA/Cocoa. (SPEC §4)
// ⚠️ UNVERIFIED SCAFFOLDING — written without a Mac. Verify selector/type encodings on-device.
//
// create(handlers) wires menu items to JS callbacks:
//   { onStartStop, onPauseResume, onSkip, onSettings, onQuit }
// Pomodoro group (Stop timer / Pause / Skip) — separator — App group (Settings / Exit).

var Tray = (function () {
  var item = null, menu = null, target = null;
  var stopItem = null, pauseItem = null, skipItem = null, settingsItem = null, exitItem = null;
  var strings = Strings.defaults();
  var running = false, paused = false;   // tracked so setStrings can relabel against current state

  function create(handlers, str) {
    if (str) strings = Strings.normalize(str);
    var t = strings.tray;
    item = $.NSStatusBar.systemStatusBar.statusItemWithLength($.NSVariableStatusItemLength);
    item.button.title = $('🫧');

    if (!$.BPMenuTarget) {
      ObjC.registerSubclass({
        name: 'BPMenuTarget',
        superclass: 'NSObject',
        methods: {
          'startStop:': { types: ['void', ['id']], implementation: function () { handlers.onStartStop(); } },
          'pauseResume:': { types: ['void', ['id']], implementation: function () { handlers.onPauseResume(); } },
          'skip:': { types: ['void', ['id']], implementation: function () { handlers.onSkip(); } },
          'settings:': { types: ['void', ['id']], implementation: function () { handlers.onSettings(); } },
          'quit:': { types: ['void', ['id']], implementation: function () { handlers.onQuit(); } }
        }
      });
    }
    target = $.BPMenuTarget.alloc.init;

    menu = $.NSMenu.alloc.init;
    menu.autoenablesItems = false;   // we control Pause's enabled state ourselves
    stopItem = addItem(t.stopTimer, 'startStop:');
    pauseItem = addItem(t.pause, 'pauseResume:');
    skipItem = addItem(t.skip, 'skip:');
    menu.addItem($.NSMenuItem.separatorItem);
    settingsItem = addItem(t.settings, 'settings:');
    exitItem = addItem(t.exit, 'quit:');
    item.menu = menu;
  }

  // Relabel menu items from a strings catalog (live preview / save). Stop/Pause keep their
  // current running/paused wording via the tracked state.
  function setStrings(str) {
    strings = Strings.normalize(str);
    var t = strings.tray;
    if (skipItem) skipItem.title = $(t.skip);
    if (settingsItem) settingsItem.title = $(t.settings);
    if (exitItem) exitItem.title = $(t.exit);
    setRunning(running);
    setPaused(paused);
  }

  function addItem(title, selector) {
    var mi = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent($(title), selector, $(''));
    mi.target = target;
    menu.addItem(mi);
    return mi;
  }

  function setPaused(isPaused) {
    paused = isPaused;
    if (pauseItem) pauseItem.title = $(isPaused ? strings.tray.resume : strings.tray.pause);
  }
  // Running -> 'Stop timer'; stopped -> 'Start timer'. Pause only makes sense while running.
  function setRunning(isRunning) {
    running = isRunning;
    if (stopItem) stopItem.title = $(isRunning ? strings.tray.stopTimer : strings.tray.startTimer);
    if (pauseItem) pauseItem.enabled = isRunning;
  }
  function setTooltip(text) { if (item && item.button) item.button.toolTip = $(text || ''); }

  return { create, setStrings, setPaused, setRunning, setTooltip };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Tray;
