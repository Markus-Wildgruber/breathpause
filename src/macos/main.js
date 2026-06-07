// main — macOS entry point. Wires core + shell, owns the clock/loop. JXA/Cocoa.
// ⚠️ UNVERIFIED SCAFFOLDING — written without a Mac. Run: osascript -l JavaScript dist/breathpause.js
// References the core (Settings/Timefmt/Breathing/Pomodoro/Eventlog) and shell
// (Sound/BubbleWindow/Tray) namespaces defined earlier in the concatenated bundle.

// (ObjC frameworks + the Storage namespace are provided by shell/storage.js, earlier in
//  the concatenated bundle.)

// ---- app state ---------------------------------------------------------------------------
var settings = Storage.readSettings();
var strings = Storage.readStrings();
var workPattern = Settings.getWorkPattern(settings);
var breakPattern = Settings.getBreakPattern(settings);
var longBreakPattern = Settings.findPattern(settings, settings.longBreakPatternId) || breakPattern;
var state = Pomodoro.initState(
  Timefmt.parseWorkSeconds(settings.timers.work),
  Timefmt.parseBreakSeconds(settings.timers.break),
  Timefmt.parseBreakSeconds(settings.timers.longBreak),
  settings.cycle.longBreakEvery,
  settings.cycle.autoContinue);
if (!settings.behavior.autoStartTimerOnLaunch) state = Pomodoro.reset(state);

var breathingT = 0;
var lastClock = $.NSDate.date.timeIntervalSince1970;
var loopTimer = null; // keep a ref so the timer is not GC'd
// Cap the per-frame advance. After sleep the wall clock is far ahead, and feeding that raw gap to
// the pomodoro tick fast-forwards through many work/break boundaries at once (a 15-min long break
// "from nowhere"). Capping makes sleep effectively pause the timer. Real frames are ~33 ms, so this
// never affects normal ticking; it only absorbs sleep gaps / long modal stalls.
var MAX_FRAME_DT = 2.0;

function now() { return $.NSDate.date.timeIntervalSince1970; }

function activePattern() {
  if (state.mode !== 'break') return workPattern;
  return state.breakKind === 'long' ? longBreakPattern : breakPattern;
}

function handleEvents(events) {
  for (var i = 0; i < events.length; i++) {
    var e = events[i];
    Storage.appendEvent(e, { mode: state.mode, cycle: state.cyclesCompleted });
  }
}

function applyModeChange(prevMode) {
  if (state.mode === prevMode) return;
  if (state.mode === 'break') BubbleWindow.enterBreakMode(settings);
  else BubbleWindow.enterWorkMode(settings);
  Sound.playChime(settings.sound.enabled);
  breathingT = 0; // restart breathing for the new pattern
}

// ---- settings apply / live preview (SPEC §6) --------------------------------------------
function applyPreview(newSettings, newStrings) {
  BubbleWindow.previewAppearance(newSettings);
  if (newStrings) { BubbleWindow.setStrings(newStrings); Tray.setStrings(newStrings); }
}
function revertSettings() { BubbleWindow.previewAppearance(settings); BubbleWindow.setStrings(strings); Tray.setStrings(strings); }
function applySettings(newSettings, newStrings) {
  Storage.writeSettings(newSettings);
  settings = newSettings;
  if (newStrings) {
    Storage.writeStrings(newStrings);
    strings = newStrings;
    BubbleWindow.setStrings(strings);
    Tray.setStrings(strings);
  }
  workPattern = Settings.getWorkPattern(settings);
  breakPattern = Settings.getBreakPattern(settings);
  longBreakPattern = Settings.findPattern(settings, settings.longBreakPatternId) || breakPattern;
  setStartOnBoot(settings.behavior.startOnBoot);
  rebuildHotkeys();
  if (state.mode === 'break') BubbleWindow.enterBreakMode(settings); else BubbleWindow.enterWorkMode(settings);
}

// ---- global hotkeys (SPEC §6) ------------------------------------------------------------
// macOS can't reuse core/hotkeys' Windows VK codes; match by character + modifier flags via a
// global NSEvent monitor. NOTE: a global keyDown monitor needs Input-Monitoring/Accessibility
// permission (one-time prompt). F-keys aren't matched (only letters/digits).
var hotkeys = [];
function parseHotkeyMac(s) {
  if (!s) return null;
  var mods = { ctrl: false, alt: false, shift: false, win: false }, key = null;
  String(s).split('+').forEach(function (p) {
    var l = p.trim().toLowerCase();
    if (l === 'ctrl' || l === 'control') mods.ctrl = true;
    else if (l === 'alt') mods.alt = true;
    else if (l === 'shift') mods.shift = true;
    else if (l === 'win' || l === 'cmd') mods.win = true;
    else key = p.trim().toUpperCase();
  });
  if (!key || !(mods.ctrl || mods.alt || mods.shift || mods.win)) return null;
  return { mods: mods, key: key };
}
function rebuildHotkeys() {
  hotkeys = [];
  var map = { startStop: handlers.onStartStop, pauseResume: handlers.onPauseResume, skip: handlers.onSkip, settings: handlers.onSettings };
  Object.keys(map).forEach(function (name) {
    var hk = parseHotkeyMac(settings.hotkeys[name]);
    if (hk) { hk.action = map[name]; hotkeys.push(hk); }
  });
}

// ---- start on boot: a LaunchAgent plist (SPEC §6) ----------------------------------------
function selfScriptPath() {
  try {
    var args = $.NSProcessInfo.processInfo.arguments;
    for (var i = 0; i < args.count; i++) {
      var a = args.objectAtIndex(i).js;
      if (a.indexOf('.js') !== -1 && a.indexOf('breathpause') !== -1) return a;
    }
  } catch (e) { }
  return '';
}
function setStartOnBoot(enabled) {
  var fm = $.NSFileManager.defaultManager;
  var dir = $.NSHomeDirectory().js + '/Library/LaunchAgents';
  var path = dir + '/com.breathpause.plist';
  try {
    if (enabled) {
      fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(dir, true, null, null);
      var sp = selfScriptPath();
      var plist = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
        '<plist version="1.0"><dict>' +
        '<key>Label</key><string>com.breathpause</string>' +
        '<key>ProgramArguments</key><array>' +
        '<string>/usr/bin/osascript</string><string>-l</string><string>JavaScript</string><string>' + sp + '</string>' +
        '</array><key>RunAtLoad</key><true/></dict></plist>';
      $(plist).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
    } else {
      fm.removeItemAtPathError(path, null);
    }
  } catch (e) { }
}

function frame() {
  var t = now();
  var dt = Pomodoro.limitFrameDt(t - lastClock, MAX_FRAME_DT);
  lastClock = t;

  if (!state.paused) breathingT += dt;
  var prev = state.mode;
  var res = Pomodoro.tick(state, dt);
  state = res.state;
  handleEvents(res.events);
  applyModeChange(prev);
  Tray.setPaused(state.paused); // keep menu in sync when a boundary auto-pauses (autoContinue off)

  var pattern = activePattern();
  var size = Breathing.sizeAt(pattern, breathingT);
  var labelText = Breathing.currentLabel(pattern, breathingT);
  var phaseText = '';
  var info = Breathing.phaseAt(pattern, breathingT);
  if (info) phaseText = String(Math.ceil(info.remaining));
  var pomoText = state.running ? Timefmt.formatRemaining(state.remaining) : '';
  BubbleWindow.render(state.mode, size, labelText, phaseText, pomoText);
  Tray.setTooltip(state.running ? (state.mode + ' ' + pomoText) : 'breathing');
}

// ---- menu handlers -----------------------------------------------------------------------
var handlers = {
  onPauseResume: function () {
    if (state.paused) { state = Pomodoro.resume(state); Storage.appendEvent('resume', {}); }
    else { state = Pomodoro.pause(state); Storage.appendEvent('pause', {}); }
    Tray.setPaused(state.paused);
  },
  onSkip: function () {
    var prev = state.mode; var res = Pomodoro.skip(state); state = res.state;
    Storage.appendEvent('skip', {}); handleEvents(res.events); applyModeChange(prev);
  },
  // User confirmed Esc / close button on the break overlay -> end the break early (SPEC §5).
  onCloseBreak: function () {
    if (state.mode !== 'break') return;
    var prev = state.mode; var res = Pomodoro.skip(state); state = res.state;
    Storage.appendEvent('skip', { reason: 'break_closed' }); handleEvents(res.events); applyModeChange(prev);
  },
  // Toggle: running -> stop to breathing-only; stopped -> start a fresh work session.
  onStartStop: function () {
    if (state.running) {
      state = Pomodoro.reset(state); Storage.appendEvent('reset', {});
      BubbleWindow.enterWorkMode(settings); Tray.setPaused(false);
    } else {
      state = Pomodoro.initState(
        Timefmt.parseWorkSeconds(settings.timers.work), Timefmt.parseBreakSeconds(settings.timers.break),
        Timefmt.parseBreakSeconds(settings.timers.longBreak), settings.cycle.longBreakEvery, settings.cycle.autoContinue);
      breathingT = 0; Storage.appendEvent('session_start', { mode: 'work' });
    }
    Tray.setRunning(state.running);
  },
  onSettings: function () { SettingsWindow.show(settings, applyPreview, applySettings, revertSettings); },
  onQuit: function () {
    if (settings.position.remember) {
      var o = BubbleWindow.origin(); settings.position.x = o.x; settings.position.y = o.y;
      Storage.writeSettings(settings);
    }
    Storage.appendEvent('quit', {});
    $.NSApp.terminate(null);
  }
};

// ---- drag: hold Cmd and drag to move the bubble (SPEC §4) ---------------------------------
// Global monitor observes (does not consume) events while click-through stays on.
$.NSEvent.addGlobalMonitorForEventsMatchingMaskHandler($.NSEventMaskLeftMouseDragged, function (ev) {
  if (BubbleWindow.isBreakActive()) return; // don't drag the fullscreen break overlay
  if (ev.modifierFlags & $.NSEventModifierFlagCommand) BubbleWindow.moveBy(ev.deltaX, ev.deltaY);
});

// ---- global hotkey monitor (character + modifier match) ----------------------------------
$.NSEvent.addGlobalMonitorForEventsMatchingMaskHandler($.NSEventMaskKeyDown, function (ev) {
  if (!hotkeys.length) return;
  var f = ev.modifierFlags;
  var ctrl = (f & $.NSEventModifierFlagControl) !== 0, alt = (f & $.NSEventModifierFlagOption) !== 0,
      shift = (f & $.NSEventModifierFlagShift) !== 0, win = (f & $.NSEventModifierFlagCommand) !== 0;
  var ch = ''; try { ch = ev.charactersIgnoringModifiers.js.toUpperCase(); } catch (e) { }
  for (var i = 0; i < hotkeys.length; i++) {
    var h = hotkeys[i];
    if (h.mods.ctrl === ctrl && h.mods.alt === alt && h.mods.shift === shift && h.mods.win === win && h.key === ch) { h.action(); break; }
  }
});

// ---- launch ------------------------------------------------------------------------------
var app = $.NSApplication.sharedApplication;
app.setActivationPolicy($.NSApplicationActivationPolicyAccessory); // menu-bar only, no dock icon
BubbleWindow.create(settings);
BubbleWindow.setStrings(strings);
BubbleWindow.setCloseBreakHandler(handlers.onCloseBreak);
Tray.create(handlers, strings);
Tray.setRunning(state.running);
setStartOnBoot(settings.behavior.startOnBoot);   // keep LaunchAgent in sync
rebuildHotkeys();
Storage.appendEvent('session_start', { mode: state.mode });

loopTimer = $.NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(1.0 / 30.0, true, function () { frame(); });
app.run;
