// shell/settingswindow — native settings window. JXA/Cocoa. (SPEC §6)
// ⚠️ UNVERIFIED SCAFFOLDING — written without a Mac. Manual-frame Cocoa layout is fiddly;
//    expect to tune positions/selectors on-device. Colors use the native NSColorWell/panel.
//    Single-column form (tabs deferred); pattern editor deferred (see PORTING.md).
//
// show(settings, onPreview, onSaved, onCancel): edits preview live; Save persists; Cancel reverts.

var SettingsWindow = (function () {
  var win = null, target = null, onPreview = null, onSaved = null, onCancel = null, saved = false;
  var base = null;            // the settings object we started from
  var c = {};                 // control references, read back on save

  function hexToColor(hex) {
    var h = (hex || '#000000').replace('#', '');
    return $.NSColor.colorWithCalibratedRedGreenBlueAlpha(
      parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255, parseInt(h.substr(4, 2), 16) / 255, 1);
  }
  function colorToHex(col) {
    var x = col.colorUsingColorSpaceName($.NSCalibratedRGBColorSpace);
    if (!x || x.isNil()) x = col;
    function h(n) { n = Math.max(0, Math.min(255, Math.round(n * 255))).toString(16); return n.length < 2 ? '0' + n : n; }
    return ('#' + h(x.redComponent) + h(x.greenComponent) + h(x.blueComponent)).toUpperCase();
  }

  function register() {
    if (!$.BPFlipped) {
      ObjC.registerSubclass({ name: 'BPFlipped', superclass: 'NSView', methods: { 'isFlipped': { types: ['bool', []], implementation: function () { return true; } } } });
    }
    if (!$.BPSettingsTarget) {
      ObjC.registerSubclass({
        name: 'BPSettingsTarget', superclass: 'NSObject',
        methods: {
          'changed:': { types: ['void', ['id']], implementation: function () { preview(); } },
          'save:': { types: ['void', ['id']], implementation: function () { save(); } },
          'cancel:': { types: ['void', ['id']], implementation: function () { closeWin(); } }
        }
      });
    }
  }

  // --- tiny manual-layout helpers (flipped view: y grows downward) ---
  var W = 460, y = 0, host = null;
  function header(text) {
    var t = $.NSTextField.alloc.initWithFrame($.NSMakeRect(20, y, W - 40, 22));
    t.stringValue = $(text); t.editable = false; t.bezeled = false; t.drawsBackground = false; t.font = $.NSFont.boldSystemFontOfSize(14);
    host.addSubview(t); y += 28;
  }
  function labelFor(text) {
    var t = $.NSTextField.alloc.initWithFrame($.NSMakeRect(20, y + 3, 180, 20));
    t.stringValue = $(text); t.editable = false; t.bezeled = false; t.drawsBackground = false; t.font = $.NSFont.systemFontOfSize(12);
    host.addSubview(t);
  }
  function textRow(text, value) {
    labelFor(text);
    var tf = $.NSTextField.alloc.initWithFrame($.NSMakeRect(210, y, 110, 22));
    tf.stringValue = $(String(value)); tf.target = target; tf.action = 'changed:';
    host.addSubview(tf); y += 30; return tf;
  }
  function sliderRow(text, min, max, value) {
    labelFor(text);
    var s = $.NSSlider.alloc.initWithFrame($.NSMakeRect(210, y, 180, 22));
    s.minValue = min; s.maxValue = max; s.doubleValue = value; s.target = target; s.action = 'changed:';
    host.addSubview(s); y += 30; return s;
  }
  function checkRow(text, on) {
    var b = $.NSButton.alloc.initWithFrame($.NSMakeRect(210, y, 230, 22));
    b.setButtonType($.NSButtonTypeSwitch); b.title = $(text); b.state = on ? $.NSControlStateValueOn : $.NSControlStateValueOff;
    b.target = target; b.action = 'changed:';
    host.addSubview(b); y += 28; return b;
  }
  function colorRow(text, hex) {
    labelFor(text);
    var w = $.NSColorWell.alloc.initWithFrame($.NSMakeRect(210, y, 60, 24));
    w.color = hexToColor(hex); w.target = target; w.action = 'changed:';
    host.addSubview(w); y += 32; return w;
  }
  function fontRow(text, current) {
    labelFor(text);
    var p = $.NSPopUpButton.alloc.initWithFrame($.NSMakeRect(210, y, 200, 24));
    var curated = ['SF Pro Text', 'Helvetica Neue', 'Helvetica', 'Menlo', 'Avenir Next', 'Arial', 'Georgia', 'Segoe UI'];
    var names = [];
    try {
      var avail = {};
      var fams = $.NSFontManager.sharedFontManager.availableFontFamilies;
      for (var i = 0; i < fams.count; i++) avail[fams.objectAtIndex(i).js] = true;
      curated.forEach(function (n) { if (avail[n]) names.push(n); });
    } catch (e) { names = curated.slice(); }
    if (current && names.indexOf(current) === -1) names.unshift(current);
    p.addItemsWithTitles($(names));
    if (current) p.selectItemWithTitle($(current));
    p.target = target; p.action = 'changed:';
    host.addSubview(p); y += 32; return p;
  }

  function show(settings, p, s, cn) {
    base = settings; onPreview = p; onSaved = s; onCancel = cn; saved = false;
    register();
    target = $.BPSettingsTarget.alloc.init;

    var a = settings.appearance;
    host = $.BPFlipped.alloc.initWithFrame($.NSMakeRect(0, 0, W, 1000));
    y = 18;
    header('Timers');
    c.work = textRow('Work (hh:mm)', settings.timers.work);
    c.brk = textRow('Break (mm:ss)', settings.timers.break);
    c.long = textRow('Long break (mm:ss)', settings.timers.longBreak);
    c.every = textRow('Long break every N (0=off)', settings.cycle.longBreakEvery);
    header('Appearance');
    c.opacity = sliderRow('Opacity', 0.1, 1, a.opacity);
    c.collapsed = textRow('Collapsed diameter (px)', a.collapsedDiameterPx);
    c.expanded = textRow('Expanded diameter (px)', a.expandedDiameterPx);
    c.breakPct = sliderRow('Break size (% screen)', 5, 100, a.breakSizePctScreenHeight);
    c.font = fontRow('Font family', a.font.family);
    c.fontSize = sliderRow('Font size (bubble text)', 8, 72, a.font.size);
    c.showLabel = checkRow('Show phase label', a.showLabel);
    c.showPhase = checkRow('Show phase countdown', a.showPhaseCountdown);
    c.showPomo = checkRow('Show pomodoro time', a.showRemainingTimeUnderBubble);
    header('Colors');
    c.workFill = colorRow('Work fill', a.colors.workFill);
    c.breakFill = colorRow('Break fill', a.colors.breakFill);
    c.textColor = colorRow('Text', a.colors.text);
    header('Behavior');
    c.auto = checkRow('Auto-start timer on launch', settings.behavior.autoStartTimerOnLaunch);
    c.autoCont = checkRow('Auto-continue to next segment', settings.cycle.autoContinue);
    c.boot = checkRow('Start on boot', settings.behavior.startOnBoot);
    c.single = checkRow('Single instance', settings.behavior.singleInstance);
    header('Sound');
    c.sound = checkRow('Chime on transitions', settings.sound.enabled);
    header('Hotkeys (e.g. Ctrl+Alt+P; needs Input Monitoring)');
    c.hkStart = textRow('Start/Stop timer', settings.hotkeys.startStop);
    c.hkPause = textRow('Pause/Resume', settings.hotkeys.pauseResume);
    c.hkSkip = textRow('Skip', settings.hotkeys.skip);
    c.hkSettings = textRow('Open settings', settings.hotkeys.settings);
    var contentH = y + 60;
    host.setFrameSize($.NSMakeSize(W, contentH));

    // Save / Cancel
    var save = $.NSButton.alloc.initWithFrame($.NSMakeRect(W - 110, y + 12, 90, 30));
    save.title = $('Save'); save.bezelStyle = $.NSBezelStyleRounded; save.target = target; save.action = 'save:'; save.keyEquivalent = $('\r');
    host.addSubview(save);
    var cancel = $.NSButton.alloc.initWithFrame($.NSMakeRect(W - 210, y + 12, 90, 30));
    cancel.title = $('Cancel'); cancel.bezelStyle = $.NSBezelStyleRounded; cancel.target = target; cancel.action = 'cancel:';
    host.addSubview(cancel);

    var winH = Math.min(contentH, 680);
    var scroll = $.NSScrollView.alloc.initWithFrame($.NSMakeRect(0, 0, W, winH));
    scroll.hasVerticalScroller = true; scroll.documentView = host;

    win = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(
      $.NSMakeRect(0, 0, W, winH),
      $.NSWindowStyleMaskTitled | $.NSWindowStyleMaskClosable, $.NSBackingStoreBuffered, false);
    win.title = $('breathpause settings');
    win.contentView = scroll;
    win.center;
    win.level = $.NSStatusWindowLevel;
    $.NSApp.activateIgnoringOtherApps(true);
    win.makeKeyAndOrderFront(null);
  }

  function valuesFromControls() {
    var n = Settings.normalize(base);
    n.timers.work = c.work.stringValue.js;
    n.timers.break = c.brk.stringValue.js;
    n.timers.longBreak = c.long.stringValue.js;
    n.cycle.longBreakEvery = parseInt(c.every.stringValue.js, 10) || 0;
    n.appearance.opacity = c.opacity.doubleValue;
    n.appearance.collapsedDiameterPx = parseInt(c.collapsed.stringValue.js, 10) || n.appearance.collapsedDiameterPx;
    n.appearance.expandedDiameterPx = parseInt(c.expanded.stringValue.js, 10) || n.appearance.expandedDiameterPx;
    n.appearance.breakSizePctScreenHeight = c.breakPct.doubleValue;
    try { n.appearance.font.family = c.font.titleOfSelectedItem.js; } catch (e) { }
    n.appearance.font.size = c.fontSize.doubleValue;
    n.appearance.showLabel = c.showLabel.state === $.NSControlStateValueOn;
    n.appearance.showPhaseCountdown = c.showPhase.state === $.NSControlStateValueOn;
    n.appearance.showRemainingTimeUnderBubble = c.showPomo.state === $.NSControlStateValueOn;
    n.appearance.colors.workFill = colorToHex(c.workFill.color);
    n.appearance.colors.breakFill = colorToHex(c.breakFill.color);
    n.appearance.colors.text = colorToHex(c.textColor.color);
    n.behavior.autoStartTimerOnLaunch = c.auto.state === $.NSControlStateValueOn;
    n.cycle.autoContinue = c.autoCont.state === $.NSControlStateValueOn;
    n.behavior.startOnBoot = c.boot.state === $.NSControlStateValueOn;
    n.behavior.singleInstance = c.single.state === $.NSControlStateValueOn;
    n.sound.enabled = c.sound.state === $.NSControlStateValueOn;
    n.hotkeys.startStop = c.hkStart.stringValue.js;
    n.hotkeys.pauseResume = c.hkPause.stringValue.js;
    n.hotkeys.skip = c.hkSkip.stringValue.js;
    n.hotkeys.settings = c.hkSettings.stringValue.js;
    return Settings.normalize(n);
  }

  function preview() { if (onPreview) onPreview(valuesFromControls()); }
  function save() { saved = true; if (onSaved) onSaved(valuesFromControls()); closeWin(); }
  function closeWin() { if (!saved && onCancel) onCancel(); if (win) win.close; }

  return { show };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SettingsWindow;
