// shell/window — always-on-top frosted orb + vibrancy-blur break. JXA/Cocoa. (SPEC §3,§4,§5)
// ⚠️ UNVERIFIED SCAFFOLDING — written without a Mac. Cocoa/CoreAnimation API + geometry are
//    plausible but UNTESTED; expect to tune on-device (esp. text stacking + gradient/shadow).
//
// Work: small borderless click-through window (orb max + glow margin); orb scales 0..1.
// Break: window covers the screen, NSVisualEffectView blurs the live desktop (no tint), orb
//        centers + enlarges, overlay captures input, Esc / close button ends the break early.

var BubbleWindow = (function () {
  var win = null, host = null, effect = null, glow = null, orb = null;
  var label = null, phase = null, pomo = null, closeBtn = null, wtarget = null;
  var appearance = null, screenFrame = null, fontSize = 16, countdownSize = 13, pomoSize = 12;
  var breakActive = false, closeHandler = null;
  var strings = Strings.defaults();
  // Pull the three live-settable font sizes out of an appearance block in one place.
  function applyFontSizes(a) { fontSize = a.font.size; countdownSize = a.font.countdownSize; pomoSize = a.font.pomodoroSize; }
  var GLOW_MARGIN = 50;

  function color(hex) {
    var h = (hex || '#000000').replace('#', '');
    var r = parseInt(h.substr(0, 2), 16) / 255, g = parseInt(h.substr(2, 2), 16) / 255, b = parseInt(h.substr(4, 2), 16) / 255;
    var a = h.length >= 8 ? parseInt(h.substr(6, 2), 16) / 255 : 1;
    return $.NSColor.colorWithCalibratedRedGreenBlueAlpha(r, g, b, a);
  }
  // Lighten (f>1) / darken (f<1) toward white/black.
  function shade(c, f) {
    var r = c.redComponent, g = c.greenComponent, b = c.blueComponent;
    if (f >= 1) { var t = f - 1; r += (1 - r) * t; g += (1 - g) * t; b += (1 - b) * t; }
    else { r *= f; g *= f; b *= f; }
    return $.NSColor.colorWithCalibratedRedGreenBlueAlpha(Math.min(1, r), Math.min(1, g), Math.min(1, b), 1);
  }

  function confirmAndClose() {
    var b = strings.break;
    var alert = $.NSAlert.alloc.init;
    alert.messageText = $(b.confirmTitle);
    alert.informativeText = $(b.confirmMessage);
    alert.addButtonWithTitle($(b.endBreak));
    alert.addButtonWithTitle($(b.cancel));
    if (alert.runModal === $.NSAlertFirstButtonReturn && closeHandler) closeHandler();
  }

  // Apply user-facing text (strings.json) to the break overlay's close button + confirm alert.
  function setStrings(str) {
    strings = Strings.normalize(str);
    if (closeBtn) closeBtn.title = $(strings.break.endBreak);
  }

  function registerClasses() {
    if (!$.BPWindow) {
      ObjC.registerSubclass({
        name: 'BPWindow', superclass: 'NSWindow',
        methods: { 'canBecomeKeyWindow': { types: ['bool', []], implementation: function () { return true; } } }
      });
    }
    if (!$.BPWindowTarget) {
      ObjC.registerSubclass({
        name: 'BPWindowTarget', superclass: 'NSObject',
        methods: { 'closeBreak:': { types: ['void', ['id']], implementation: function () { confirmAndClose(); } } }
      });
    }
  }

  // Frosted glassy orb: a glow layer (shadow) under a radial-gradient circle. Built per the
  // base colour; geometry set each frame in render().
  function setOrbColor(hex) {
    var base = color(hex);
    if (glow) { glow.fillColor = base.CGColor; glow.shadowColor = base.CGColor; }
    if (orb) {
      orb.colors = [shade(base, 1.5).CGColor, base.CGColor, shade(base, 0.68).CGColor];
      orb.locations = [0.0, 0.62, 1.0];
    }
  }

  function makeTextLayer() {
    var t = $.CATextLayer.layer;
    t.alignmentMode = 'center';
    t.foregroundColor = color(appearance.colors.text).CGColor;
    t.contentsScale = $.NSScreen.mainScreen.backingScaleFactor; // crisp text on retina
    return t;
  }

  function create(settings) {
    appearance = settings.appearance;
    applyFontSizes(appearance);
    screenFrame = $.NSScreen.mainScreen.frame;
    var d = appearance.expandedDiameterPx + 2 * GLOW_MARGIN;
    var rect = $.NSMakeRect(0, 0, d, d);

    registerClasses();
    wtarget = $.BPWindowTarget.alloc.init;

    win = $.BPWindow.alloc.initWithContentRectStyleMaskBackingDefer(
      rect, $.NSWindowStyleMaskBorderless, $.NSBackingStoreBuffered, false);
    win.level = $.NSStatusWindowLevel;
    win.opaque = false;
    win.backgroundColor = $.NSColor.clearColor;
    win.ignoresMouseEvents = true;
    win.hasShadow = false;
    win.collectionBehavior =
      $.NSWindowCollectionBehaviorCanJoinAllSpaces |
      $.NSWindowCollectionBehaviorFullScreenAuxiliary |
      $.NSWindowCollectionBehaviorStationary;

    host = $.NSView.alloc.initWithFrame(rect);
    host.wantsLayer = true;

    // Break backdrop: live-desktop blur (hidden in work mode). On macOS this blurs the real
    // screen even fullscreen — no screen capture needed (unlike Windows).
    effect = $.NSVisualEffectView.alloc.initWithFrame(rect);
    effect.material = $.NSVisualEffectMaterialFullScreenUI;
    effect.blendingMode = $.NSVisualEffectBlendingModeBehindWindow;
    effect.state = $.NSVisualEffectStateActive;
    effect.hidden = true;
    effect.autoresizingMask = $.NSViewWidthSizable | $.NSViewHeightSizable;
    host.addSubview(effect);

    glow = $.CAShapeLayer.layer;          // soft colored glow (shadow, not clipped)
    glow.shadowRadius = 24; glow.shadowOpacity = 0.85; glow.shadowOffset = $.CGSizeMake(0, 0);
    glow.masksToBounds = false;
    host.layer.addSublayer(glow);

    orb = $.CAGradientLayer.layer;        // glassy radial sphere (clipped to a circle)
    orb.type = 'radial';
    orb.startPoint = $.CGPointMake(0.5, 0.5);
    orb.endPoint = $.CGPointMake(1.0, 1.0);
    orb.opacity = appearance.opacity;
    orb.masksToBounds = true;
    host.layer.addSublayer(orb);

    label = makeTextLayer(); host.layer.addSublayer(label);
    phase = makeTextLayer(); host.layer.addSublayer(phase);
    pomo = makeTextLayer(); host.layer.addSublayer(pomo);

    closeBtn = $.NSButton.buttonWithTitleTargetAction($(strings.break.endBreak), wtarget, 'closeBreak:');
    closeBtn.hidden = true;
    host.addSubview(closeBtn);

    win.contentView = host;
    win.orderFrontRegardless;
    setOrbColor(appearance.colors.workFill);

    $.NSEvent.addLocalMonitorForEventsMatchingMaskHandler($.NSEventMaskKeyDown, function (ev) {
      if (breakActive && ev.keyCode === 53) { confirmAndClose(); return null; } // 53 = Esc
      return ev;
    });

    enterWorkMode(settings);
  }

  function setCloseBreakHandler(fn) { closeHandler = fn; }
  function isBreakActive() { return breakActive; }

  function setContentSize(w, h) {
    win.setFrame($.NSMakeRect(win.frame.origin.x, win.frame.origin.y, w, h), true);
    host.frame = $.NSMakeRect(0, 0, w, h);
    effect.frame = host.frame;
  }

  // Place the orb (not the window) ~gap from the top-right corner; window is bigger by the
  // transparent glow margin on each side (Cocoa origin is bottom-left).
  function placeTopRight() {
    var gap = 16, W = win.frame.size.width;
    var sr = screenFrame.origin.x + screenFrame.size.width;
    var st = screenFrame.origin.y + screenFrame.size.height;
    win.setFrameOrigin($.NSMakePoint(sr - gap + GLOW_MARGIN - W, st - gap + GLOW_MARGIN - W));
  }

  function enterWorkMode(settings) {
    appearance = settings.appearance; applyFontSizes(appearance);
    breakActive = false; effect.hidden = true; closeBtn.hidden = true;
    win.ignoresMouseEvents = true;
    orb.opacity = appearance.opacity;
    setOrbColor(appearance.colors.workFill);
    setContentSize(appearance.expandedDiameterPx + 2 * GLOW_MARGIN, appearance.expandedDiameterPx + 2 * GLOW_MARGIN);
    var pos = settings.position;
    if (pos && pos.remember && typeof pos.x === 'number' && typeof pos.y === 'number') win.setFrameOrigin($.NSMakePoint(pos.x, pos.y));
    else placeTopRight();
  }

  function enterBreakMode(settings) {
    appearance = settings.appearance; applyFontSizes(appearance);
    breakActive = true;
    setOrbColor(settings.appearance.colors.breakFill);
    effect.hidden = false;                          // live-desktop blur, no tint
    win.setFrame(screenFrame, true);
    host.frame = $.NSMakeRect(0, 0, screenFrame.size.width, screenFrame.size.height);
    effect.frame = host.frame;
    win.ignoresMouseEvents = false;
    win.makeKeyAndOrderFront(null);
    $.NSApp.activateIgnoringOtherApps(true);
    closeBtn.setFrame($.NSMakeRect(screenFrame.size.width - 150, screenFrame.size.height - 50, 130, 30));
    try { closeBtn.bezelColor = color(settings.appearance.colors.breakFill); } catch (e) { } // match break bubble
    closeBtn.hidden = false;
  }

  function placeText(layer, text, show, cx, cyTop, h, fs) {
    layer.font = $(appearance.font.family);   // family + size both live (appearance updates on preview)
    layer.fontSize = fs;
    layer.string = text || '';
    layer.frame = $.NSMakeRect(cx - 120, cyTop, 240, h);
    layer.hidden = !show || !text;
  }

  // size 0..1; three centered lines: label / phase / pomodoro (Cocoa y is bottom-up).
  function render(mode, size, labelText, phaseText, pomoText) {
    var W = host.frame.size.width, H = host.frame.size.height;
    var collapsed = appearance.collapsedDiameterPx;
    var expanded = (mode === 'break') ? (screenFrame.size.height * (appearance.breakSizePctScreenHeight / 100)) : appearance.expandedDiameterPx;
    var dia = collapsed + size * (expanded - collapsed);
    var cx = W / 2, cy = H / 2, r = dia / 2;

    $.CATransaction.begin;
    $.CATransaction.setDisableActions(true);
    var rect = $.NSMakeRect(cx - r, cy - r, dia, dia);
    glow.path = $.CGPathCreateWithEllipseInRect(rect, null);
    orb.frame = rect; orb.cornerRadius = r;
    var fs = fontSize;
    // Vertical positions key off the label size; each line renders at its own configured size.
    placeText(label, labelText, appearance.showLabel, cx, cy + fs * 0.5, fs * 1.4, fs);
    placeText(phase, phaseText, appearance.showPhaseCountdown, cx, cy - fs * 0.4, fs * 1.2, countdownSize);
    placeText(pomo, pomoText, appearance.showRemainingTimeUnderBubble, cx, cy - fs * 1.5, fs * 1.1, pomoSize);
    $.CATransaction.commit;
  }

  function moveBy(dx, dy) { var o = win.frame.origin; win.setFrameOrigin($.NSMakePoint(o.x + dx, o.y - dy)); }
  function origin() { return { x: win.frame.origin.x, y: win.frame.origin.y }; }

  // Live settings preview: update colors/opacity/text/font without persisting or repositioning.
  function previewAppearance(settings) {
    appearance = settings.appearance; applyFontSizes(appearance);
    if (orb) orb.opacity = appearance.opacity;
    setOrbColor(breakActive ? appearance.colors.breakFill : appearance.colors.workFill);
    var tc = color(appearance.colors.text).CGColor;
    [label, phase, pomo].forEach(function (l) { if (l) l.foregroundColor = tc; });
  }

  return { create, enterWorkMode, enterBreakMode, render, moveBy, origin, setCloseBreakHandler, isBreakActive, previewAppearance, setStrings };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = BubbleWindow;
