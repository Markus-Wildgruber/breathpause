<script>
  import { onMount } from 'svelte';
  import Breathing from './core/breathing.js';
  import Pomodoro from './core/pomodoro.js';
  import Timefmt from './core/timefmt.js';
  import Pattern from './core/pattern.js';
  import { loadSkin, loadSkinById, mountSkin } from './lib/skin.js';
  import { setupHoverDrag, setHoverDragActive, setPinned } from './lib/interactivity.js';
  import { loadSettings, saveSettings, mergePatch, modeKey } from './lib/settings-store.js';
  import { editLayout, editMargin } from './lib/edit-layout.js';

  let settings = $state(loadSettings());

  let stage;
  let label = $state('');
  let phaseCountdown = $state('');
  let pomoText = $state('');
  let sessionsText = $state('');
  let textColor = $state('#eef6ff');
  let skinError = $state('');
  let ap = $state(settings.appearance.work);

  const forced = new URLSearchParams(location.search).get('skin');
  const skins = {};
  let mounted = null;
  let currentMode = null;

  // Break takes over the whole screen with a frosted overlay; these drive that view.
  let breaking = $state(false);
  let confirmLeave = $state(false);
  // Blob URL of a screenshot of the break monitor; the overlay shows it CSS-blurred.
  let breakShot = $state('');
  // Lifted out of onMount so the exit/Esc handlers can advance the pomodoro.
  let pomo = null;
  let paused = false;

  function playChime() {
    if (!settings.behavior?.chimeOnTransitions) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = 528;
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 1.5);
    } catch {}
  }

  async function skinFor(mode) {
    const name = forced || settings.appearance[modeKey(mode)].skin || 'orb';
    if (!skins[name]) {
      try {
        skins[name] = await loadSkinById(name, settings.customSkins);
      } catch (e) {
        skinError = `${e.message} — falling back to orb`;
        console.warn('skin load failed:', e);
        skins[name] = await loadSkin('skins/orb');
      }
    }
    return skins[name];
  }

  // Work: small click-through bubble parked in a corner.
  // Break: fullscreen, fully interactive frosted overlay (sized/centered via CSS).
  async function applyWindowForMode(mode) {
    if (!('__TAURI_INTERNALS__' in window)) return;
    const { getCurrentWindow, currentMonitor, LogicalSize, LogicalPosition, PhysicalSize, PhysicalPosition } =
      await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    if (mode === 'break') {
      await setHoverDragActive(false);     // pause hover-drag, make the overlay clickable
      await win.setDecorations(false);     // no title bar over the break overlay
      // The frost is a CSS-blurred screenshot of the desktop, taken while the window is
      // still the small bubble. Window effects (acrylic) looked like a flat overlay,
      // turned solid gray whenever the overlay lost focus, and glitched on multi-monitor;
      // backdrop-filter can't sample the desktop behind a transparent window at all.
      const mon = await currentMonitor();
      if (mon) {
        try {
          // Hide the bubble so it isn't in its own screenshot; the pause also lets
          // the desktop repaint before we capture.
          await win.hide();
          await new Promise(r => setTimeout(r, 80));
          const { invoke } = await import('@tauri-apps/api/core');
          const png = await invoke('capture_monitor', {
            x: mon.position.x + Math.floor(mon.size.width / 2),
            y: mon.position.y + Math.floor(mon.size.height / 2),
          });
          if (breakShot) URL.revokeObjectURL(breakShot);
          breakShot = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
        } catch (e) {
          breakShot = '';                  // overlay falls back to the plain tint
          console.warn('screen capture failed:', e);
        }
        // Cover exactly the monitor the bubble is on, in physical pixels. Logical
        // window.screen math assumed the primary monitor and mis-sized the window
        // under mixed DPI, spilling black onto neighboring screens.
        await win.setSize(new PhysicalSize(mon.size.width, mon.size.height));
        await win.setPosition(new PhysicalPosition(mon.position.x, mon.position.y));
        await win.show();                  // reappear already fullscreen — no resize flash
      } else {
        await win.setSize(new LogicalSize(window.screen.width, window.screen.height));
        await win.setPosition(new LogicalPosition(0, 0));
      }
      await win.setFocus();                // so Esc/Enter reach the window
      return;
    }
    if (breakShot) { URL.revokeObjectURL(breakShot); breakShot = ''; }
    await win.setFullscreen(false);
    // Window width = skin width so the skin's right edge IS the window's right edge — at
    // posRight 0 the skin sits flush in the top-right corner. Grows down-left as size changes.
    const winW = ap.sizePx;
    const winH = ap.sizePx + 64;
    const dpr = window.devicePixelRatio || 1;
    const screenW = window.screen.availWidth / dpr;
    const x = Math.max(0, screenW - winW - (ap.posRight ?? 40));
    const y = Math.max(0, ap.posTop ?? 40);
    await win.setSize(new LogicalSize(winW, winH));
    await win.setPosition(new LogicalPosition(x, y));
    await setHoverDragActive(true);        // re-arm click-through
  }

  async function showMode(mode) {
    currentMode = mode;
    breaking = (mode === 'break');
    if (mode !== 'break') confirmLeave = false;
    ap = settings.appearance[modeKey(mode)];
    const skin = await skinFor(mode);
    currentSkin = skin;
    textColor = ap.textColor || skin.manifest.text?.color || '#eef6ff';
    mounted = mountSkin(stage, skin, { fill: settings.skinColors?.[ap.skin] });
    await applyWindowForMode(mode);
  }

  // End the break early and return to work (the exit button / Esc confirmation).
  // Idempotent: Enter can fire both the focused button's click and the window handler.
  function leaveBreak() {
    if (!confirmLeave) return;
    confirmLeave = false;
    if (pomo) pomo = Pomodoro.skip(pomo).state;
  }
  function requestLeave() { confirmLeave = true; }
  function cancelLeave() { confirmLeave = false; }

  // ===== bubble edit mode: drag/size/color each text line =====
  // 'label' = phase line, 'sub' = pomodoro line; keys match labelSize/subSize etc.
  const SIZE_RANGE = { label: [10, 32], sub: [6, 24] };
  // The two parts of each line that can be shown/hidden.
  const LINE_PARTS = {
    label: [['showPhaseLabel', 'Phase'], ['showPhaseCountdown', 'Count']],
    sub: [['showPomodoro', 'Timer'], ['showSessions', 'Sessions']],
  };
  const BUBBLE_RANGE = [60, 480];    // same as the settings window's size slider
  const PRESETS = ['#FFFFFF', '#EEF6FF', '#FFD166', '#F4A261', '#E76F51', '#EF476F',
                   '#06D6A0', '#2EC4B6', '#118AB2', '#8E7DFF', '#9AA0A6'];
  // Room (CSS px) the window grows by on each side: side rail (76) + color panel (190) + gaps.
  const EDIT_ROOM = 300;

  let editing = $state(false);
  let selected = $state(null);       // 'bubble' | 'label' | 'sub' | null
  let colorOpen = $state(false);
  let hexDraft = $state('');
  let dialog = $state(null);         // 'hide' | 'save' | null
  let dontAsk = $state(false);
  let editPad = $state(null);        // editLayout() result while the window is widened
  let editSnapshot = $state.raw(null); // { work, skinColors } to restore on discard
  let currentSkin = null;            // mounted skin, for re-coloring the bubble live

  // Edit UI follows the settings window's light/dark choice (OS theme when unset).
  const osTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  let uiTheme = $derived(settings.theme || osTheme);

  let sizeKey = $derived(selected === 'bubble' ? 'sizePx' : selected + 'Size');
  let sizeRange = $derived(selected === 'bubble'
    ? [BUBBLE_RANGE[0], editPad?.maxSize ?? BUBBLE_RANGE[1]]
    : SIZE_RANGE[selected] ?? [0, 0]);

  async function emitEvent(name) {
    if (!('__TAURI_INTERNALS__' in window)) return;
    const { emit } = await import('@tauri-apps/api/event');
    await emit(name);
  }

  // Write only what the bubble owns onto a fresh load, so a concurrent save from the
  // settings window or pattern editor isn't clobbered by this window's stale copy.
  async function persistBubbleSettings() {
    const fresh = loadSettings();
    fresh.appearance.work = $state.snapshot(settings.appearance.work);
    fresh.skinColors = $state.snapshot(settings.skinColors);
    fresh.behavior.hideNoticeOff = settings.behavior.hideNoticeOff;
    fresh.behavior.editAutoSave = settings.behavior.editAutoSave;
    saveSettings(fresh);
    await emitEvent('bubble-settings-saved');
  }

  // Widen the window around the bubble without moving it on screen, with room for the
  // controls and for the bubble to grow to its max (see edit-layout.js).
  async function expandWindow() {
    const base = { sizePx: ap.sizePx, room: EDIT_ROOM, maxBubble: BUBBLE_RANGE[1] };
    if (!('__TAURI_INTERNALS__' in window)) {
      editPad = editLayout({ ...base, x: 0, y: 0, w: ap.sizePx, h: ap.sizePx + 64, monX: 0, monY: 0,
                             monW: innerWidth, monH: innerHeight, sf: 1 });
      return;
    }
    const { getCurrentWindow, currentMonitor, PhysicalPosition, PhysicalSize } =
      await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    const [pos, size, mon] = await Promise.all([win.outerPosition(), win.outerSize(), currentMonitor()]);
    const sf = mon?.scaleFactor || window.devicePixelRatio || 1;
    const l = editLayout({
      ...base, x: pos.x, y: pos.y, w: size.width, h: size.height, sf,
      monX: mon ? mon.position.x : pos.x - 10000, monY: mon ? mon.position.y : pos.y,
      monW: mon ? mon.size.width : 20000 + size.width, monH: mon ? mon.size.height : size.height,
    });
    editPad = l;
    await win.setPosition(new PhysicalPosition(l.x, pos.y));
    await win.setSize(new PhysicalSize(l.width, l.height));
    await win.setFocus();                  // so Esc reaches the window
  }

  function remountSkin() {
    if (currentSkin) mounted = mountSkin(stage, currentSkin, { fill: settings.skinColors?.[ap.skin] });
  }

  async function startEdit() {
    editSnapshot = {
      work: $state.snapshot(settings.appearance.work),
      skinColors: $state.snapshot(settings.skinColors),
    };
    editing = true;
    selected = null;
    setPinned(true);
    await expandWindow();
  }

  // relayout=false when a mode switch is about to lay the window out anyway.
  async function finishEdit(save, relayout = true) {
    if (!editing) return;
    editing = false;
    selected = null;
    colorOpen = false;
    dialog = null;
    if (save) {
      await persistBubbleSettings();
    } else {
      Object.assign(settings.appearance.work, editSnapshot.work);
      settings.skinColors = editSnapshot.skinColors;
      remountSkin();
    }
    editSnapshot = null;
    setPinned(false);
    editPad = null;
    // Normal layout from the (possibly new) size: keeps the bubble's right edge in place.
    if (relayout) await applyWindowForMode('work');
  }

  function editChanged() {
    return JSON.stringify({
      work: $state.snapshot(settings.appearance.work),
      skinColors: $state.snapshot(settings.skinColors),
    }) !== JSON.stringify(editSnapshot);
  }

  function escInEdit() {
    if (dialog) { dialog = null; return; }
    if (colorOpen) { colorOpen = false; return; }
    if (!editChanged()) finishEdit(false);
    else if (settings.behavior.editAutoSave) finishEdit(true);
    else { dontAsk = false; dialog = 'save'; }
  }

  function answerSave(save) {
    if (save && dontAsk) settings.behavior.editAutoSave = true;
    finishEdit(save);
  }

  function hideBubble() {
    if (settings.behavior.hideNoticeOff) { emitEvent('toggle-bubble'); return; }
    dontAsk = false;
    dialog = 'hide';
    setPinned(true);                       // keep the notice clickable if the cursor wanders
  }

  async function confirmHide() {
    dialog = null;
    setPinned(false);
    if (dontAsk) {
      settings.behavior.hideNoticeOff = true;
      await persistBubbleSettings();
    }
    emitEvent('toggle-bubble');
  }

  function selectLine(e, which) {
    if (!editing || e.button !== 0) return;
    e.preventDefault();
    selected = which;
    colorOpen = false;
    const el = e.currentTarget;
    const kx = which + 'OffsetX', ky = which + 'OffsetY';
    const startX = e.clientX - (ap[kx] ?? 0), startY = e.clientY - (ap[ky] ?? 0);
    // Snap ("dock") the line's center onto the skin's center axes when it gets close.
    const SNAP = 6;
    const lr = el.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    const baseX = lr.left + lr.width / 2 - (ap[kx] ?? 0), baseY = lr.top + lr.height / 2 - (ap[ky] ?? 0);
    const snapX = sr.left + sr.width / 2 - baseX, snapY = sr.top + sr.height / 2 - baseY;
    const dock = (v, target) => (Math.abs(v - target) <= SNAP ? target : v);
    // Keep the line inside the normal (non-edit) bubble window so it can't get lost.
    const half = ap.sizePx / 2;
    const clamp = (v, lo, hi) => Math.round(Math.min(hi, Math.max(lo, v)));
    el.setPointerCapture(e.pointerId);
    const move = (ev) => {
      ap[kx] = clamp(dock(ev.clientX - startX, snapX), -half, half);
      ap[ky] = clamp(dock(ev.clientY - startY, snapY), -ap.sizePx, 48);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  function selectBubble(e) {
    if (!editing || e.button !== 0) return;
    selected = 'bubble';
    colorOpen = false;
  }

  function deselect(e) {
    if (editing && !e.target.closest('.edit-ui, .tline, .stage')) { selected = null; colorOpen = false; }
  }

  // Color of the selection: a text line's own color, or the bubble's per-skin fill.
  // '' = default (shared text color / the skin as authored).
  function selColor() {
    if (selected === 'bubble') return settings.skinColors[ap.skin] ?? '';
    return ap[selected + 'Color'] || '';
  }
  function shownColor() {
    if (selected === 'bubble') return selColor() || currentSkin?.manifest.themeColor || '#888888';
    return selColor() || textColor;
  }

  function openColor() {
    hexDraft = shownColor();
    colorOpen = !colorOpen;
  }

  function setColor(c) {
    if (selected === 'bubble') {
      if (c) settings.skinColors[ap.skin] = c;
      else delete settings.skinColors[ap.skin];
      remountSkin();
    } else {
      ap[selected + 'Color'] = c;
    }
    hexDraft = shownColor();
  }

  function onHexInput() {
    const m = hexDraft.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return;
    const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    const draft = hexDraft;
    setColor('#' + h.toUpperCase());
    hexDraft = draft;                      // don't rewrite the field while the user types
  }

  function newPomo() {
    const t = settings.timers;
    return Pomodoro.initState(t.workSeconds, t.breakSeconds, t.longBreakSeconds, t.longBreakEvery, true);
  }

  onMount(async () => {
    pomo = newPomo();
    paused = false;

    // Esc opens the leave-break confirmation; Enter confirms it (default = leave).
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && (editing || dialog)) {
        e.preventDefault();
        if (editing) escInEdit();
        else { dialog = null; setPinned(false); }
        return;
      }
      if (!breaking) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        confirmLeave ? cancelLeave() : requestLeave();
      } else if (e.key === 'Enter' && confirmLeave) {
        e.preventDefault();
        leaveBreak();
      }
    });

    if ('__TAURI_INTERNALS__' in window) {
      document.body.classList.add('tauri');
      setupHoverDrag();
      const { listen, emit } = await import('@tauri-apps/api/event');
      function setPaused(p) {
        paused = p;
        pomo = paused ? Pomodoro.pause(pomo) : Pomodoro.resume(pomo);
        emit('paused-changed', { paused });   // let the tray menu show Pause vs Resume
      }
      let pausedByHide = false;
      listen('toggle-pause', () => {
        pausedByHide = false;
        setPaused(!paused);
      });
      // Hiding the bubble puts the pomodoro on hold (no surprise break overlay while
      // hidden). Showing it again resumes only a hide-pause, never a manual one.
      listen('visibility-changed', ({ payload: visible }) => {
        if (!visible && !paused) {
          pausedByHide = true;
          setPaused(true);
        } else if (visible && pausedByHide) {
          pausedByHide = false;
          setPaused(false);
        }
      });
      // Same for a locked screen: hold while locked, resume only a lock-pause on unlock.
      let pausedByLock = false;
      listen('screen-locked', ({ payload: locked }) => {
        if (locked && !paused) {
          pausedByLock = true;
          setPaused(true);
        } else if (!locked && pausedByLock) {
          pausedByLock = false;
          setPaused(false);
        }
      });

      // OS-global hotkeys: the OS registers each combo and notifies us regardless of
      // which app has focus. A combo some other app already owns simply fails to
      // register — logged and skipped, everything else still works.
      const { register, unregisterAll } = await import('@tauri-apps/plugin-global-shortcut');
      const hotkeyActions = {
        // stop = back to a fresh work session, on hold; start = run again
        startStop: () => {
          pausedByHide = false;
          if (paused) {
            setPaused(false);
          } else {
            pomo = newPomo();
            setPaused(true);
          }
        },
        pauseResume: () => { pausedByHide = false; setPaused(!paused); },
        skip: () => { pomo = Pomodoro.skip(pomo).state; },
        settings: () => emit('open-settings'),
        hide: () => emit('toggle-bubble'),
      };
      async function applyHotkeys() {
        try { await unregisterAll(); } catch {}
        for (const [action, fn] of Object.entries(hotkeyActions)) {
          const combo = settings.hotkeys?.[action];
          if (!combo) continue;
          try {
            await register(combo, (e) => { if (e.state === 'Pressed') fn(); });
          } catch (err) {
            console.warn(`hotkey ${combo} not available:`, err);
          }
        }
      }
      await applyHotkeys();

      // CLI/e2e hooks: --apply-settings '<json>' merges a patch into the saved
      // settings before first paint; --settings opens the settings window.
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const opts = await invoke('launch_options');
        if (opts.apply_settings) {
          saveSettings(mergePatch(loadSettings(), JSON.parse(opts.apply_settings)));
          settings = loadSettings();
          pomo = Pomodoro.applyConfig(pomo, settings.timers);
        }
        if (opts.open_settings) emit('open-settings');
      } catch (e) {
        console.warn('launch options:', e);
      }

      // Start-on-boot: mirror the checkbox into the OS autostart entry.
      const { enable, disable, isEnabled } = await import('@tauri-apps/plugin-autostart');
      async function syncAutostart() {
        try {
          const want = !!settings.behavior?.startOnBoot;
          if (want !== await isEnabled()) await (want ? enable() : disable());
        } catch (e) {
          console.warn('autostart sync failed:', e);
        }
      }
      await syncAutostart();
      listen('settings-changed', async () => {
        // A save from the settings window wins over unsaved bubble edits.
        await finishEdit(false);
        // Invalidate skin cache so new skin picks are loaded
        for (const k of Object.keys(skins)) delete skins[k];
        settings = loadSettings();
        // Apply the new timers to the running session instead of restarting it, so saving
        // settings (appearance, patterns, an unchanged work timer) keeps the live countdown.
        pomo = Pomodoro.applyConfig(pomo, settings.timers);
        await showMode(pomo.mode);
        await applyHotkeys();
        await syncAutostart();
      });

      // Persist manual drags (work only): keep the saved corner offset in sync with reality.
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      let moveTimer;
      getCurrentWindow().onMoved(({ payload: { x, y } }) => {
        if (currentMode !== 'work') return;   // break is fullscreen — nothing to persist
        clearTimeout(moveTimer);
        moveTimer = setTimeout(() => {
          if (editing) return;                // edit mode widened the window; not a real move
          const dpr = window.devicePixelRatio || 1;
          const winW = settings.appearance.work.sizePx;
          const screenW = window.screen.availWidth / dpr;
          settings.appearance.work.posRight = Math.max(0, Math.round(screenW - winW - x / dpr));
          settings.appearance.work.posTop = Math.max(0, Math.round(y / dpr));
          saveSettings($state.snapshot(settings));
        }, 300);
      });
    }
    await showMode(pomo.mode);

    const start = performance.now();
    let last = start;
    let breathT = 0;

    function frame(now) {
      // Cap the per-frame delta at 1s so waking from sleep doesn't fast-forward
      // through many work/break boundaries at once (effectively pauses during sleep).
      const dt = Pomodoro.limitFrameDt ? Pomodoro.limitFrameDt((now - last) / 1000, 1) : (now - last) / 1000;
      last = now;

      const r = Pomodoro.tick(pomo, dt);
      if (r.events?.some(ev => ev === 'work_complete' || ev === 'break_complete')) playChime();
      pomo = r.state;
      if (pomo.mode !== currentMode) {
        // Break starting mid-edit: keep the edits; showMode resizes the window itself.
        finishEdit(true, false);
        if (dialog === 'hide') { dialog = null; setPinned(false); }
        breathT = 0;
        showMode(pomo.mode);
      }

      const pattern = Pattern.toEnginePattern(settings, currentMode);
      if (!paused) breathT += dt;
      const breath = Breathing.sizeAt(pattern, breathT);
      mounted?.apply({ breath, time: Math.sin(breathT) });

      if (paused) {
        label = 'paused';
        phaseCountdown = pomoText = sessionsText = '';
      } else {
        const info = Breathing.phaseAt(pattern, breathT);
        label = ap.showPhaseLabel ? Breathing.currentLabel(pattern, breathT) : '';
        if (ap.showPhaseCountdown && info) {
          const remain = Math.ceil(info.remaining);
          // Phases are seconds long: show the bare second, append it to the phase label.
          phaseCountdown = remain < 60 ? String(remain) : Timefmt.formatRemaining(remain);
        } else {
          phaseCountdown = '';
        }
        pomoText = ap.showPomodoro ? Timefmt.formatRemaining(pomo.remaining) : '';
        sessionsText = (ap.showSessions && pomo.longBreakEvery > 0)
          ? `[${pomo.longBreakEvery - (pomo.workCount % pomo.longBreakEvery)}]` : '';
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
</script>

<!-- In edit mode the bubble keeps its right edge while its size changes, like the normal layout. -->
<main class:breaking class:editing style:font-family={ap.font} data-theme={uiTheme}
      style:width={editPad ? `${ap.sizePx}px` : null}
      style:margin-left={editPad
        ? `${editMargin(editPad, editSnapshot?.work.sizePx ?? ap.sizePx, ap.sizePx, EDIT_ROOM)}px` : null}
      onpointerdown={deselect}>
  {#if breaking && breakShot}
    <div class="break-bg" style:background-image="url({breakShot})"></div>
  {/if}
  {#if breaking}
    <button class="break-exit" onclick={requestLeave} title="Leave break" aria-label="Leave break">✕</button>
  {/if}

  <div class="stage" bind:this={stage} class:sel={selected === 'bubble'} role="presentation"
       style:width={breaking ? `${ap.sizePct ?? 45}vh` : `${ap.sizePx}px`}
       style:height={breaking ? `${ap.sizePct ?? 45}vh` : `${ap.sizePx}px`}
       style:opacity={ap.opacity}
       onpointerdown={selectBubble}></div>
  <div class="textblock" style:transform="translate({ap.textOffsetX ?? 0}px, {ap.textOffsetY ?? 0}px)">
    <!-- Empty lines get a placeholder in edit mode so they can still be grabbed. -->
    <div class="label tline" class:sel={selected === 'label'} role="presentation"
         style:color={ap.labelColor || textColor} style:font-size="{ap.labelSize}px"
         style:transform="translate({ap.labelOffsetX ?? 0}px, {ap.labelOffsetY ?? 0}px)"
         onpointerdown={(e) => selectLine(e, 'label')}>{[label, phaseCountdown].filter(Boolean).join(' ') || (editing ? 'Text' : '')}</div>
    <div class="pomo tline" class:sel={selected === 'sub'} role="presentation"
         style:color={ap.subColor || textColor} style:font-size="{ap.subSize}px"
         style:transform="translate({ap.subOffsetX ?? 0}px, {ap.subOffsetY ?? 0}px)"
         onpointerdown={(e) => selectLine(e, 'sub')}>{[pomoText, sessionsText].filter(Boolean).join('  ') || (editing ? '00:00' : '')}</div>
  </div>

  {#if !breaking}
    <div class="bubble-btns edit-ui" class:show={editing}>
      <button class="bb" onclick={() => (editing ? finishEdit(true) : startEdit())}
              title={editing ? 'Save' : 'Edit'} aria-label={editing ? 'Save' : 'Edit'}>
        {#if editing}
          <svg viewBox="0 0 16 16"><path d="M3 8.5l3 3 7-7" /></svg>
        {:else}
          <svg viewBox="0 0 16 16"><path d="M10.5 2.5l3 3L5.5 13.5H2.5v-3z" /></svg>
        {/if}
      </button>
      {#if !editing}
        <button class="bb" onclick={() => emitEvent('open-settings')} title="Settings" aria-label="Settings">
          <svg viewBox="0 0 16 16"><path d="M12.8 6.01L14.84 6.5V9.5L12.8 9.99L13.9 11.77L11.77 13.9L9.99 12.8L9.5 14.84H6.5L6.01 12.8L4.23 13.9L2.1 11.77L3.2 9.99L1.16 9.5V6.5L3.2 6.01L2.1 4.23L4.23 2.1L6.01 3.2L6.5 1.16H9.5L9.99 3.2L11.77 2.1L13.9 4.23Z" /><circle cx="8" cy="8" r="2.2" /></svg>
        </button>
        <button class="bb" onclick={hideBubble} title="Hide" aria-label="Hide">
          <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      {/if}
    </div>
  {/if}

  {#if editing && selected}
    <div class="side edit-ui {editPad?.side ?? 'right'}">
      <div class="rails">
        <div class="rail">
          <span class="side-cap">Size</span>
          <input class="vrange" type="range" min={sizeRange[0]} max={sizeRange[1]}
                 bind:value={ap[sizeKey]} aria-label={selected === 'bubble' ? 'Bubble size' : 'Text size'} />
          <span class="side-val">{ap[sizeKey]}px</span>
        </div>
        {#if selected === 'bubble'}
          <!-- Same 20–100% range as the settings window's opacity slider. -->
          <div class="rail">
            <span class="side-cap">Opacity</span>
            <input class="vrange" type="range" min="20" max="100" aria-label="Bubble opacity"
                   bind:value={() => Math.round(ap.opacity * 100), (v) => (ap.opacity = v / 100)} />
            <span class="side-val">{Math.round(ap.opacity * 100)}%</span>
          </div>
        {/if}
      </div>
      <button class="swatch" style:background={shownColor()} onclick={openColor}
              title={selected === 'bubble' ? 'Bubble color' : 'Text color'}
              aria-label={selected === 'bubble' ? 'Bubble color' : 'Text color'}></button>
      {#if selected !== 'bubble'}
        <div class="parts">
          {#each LINE_PARTS[selected] as [key, name] (key)}
            <label class="part"><input type="checkbox" bind:checked={ap[key]} /> {name}</label>
          {/each}
        </div>
      {/if}
      {#if colorOpen}
        <div class="color-panel">
          <div class="presets">
            <!-- First tile = free pick: the native color picker, dressed as a swatch. -->
            <label class="preset custom" title="Custom color">
              <svg viewBox="0 0 16 16"><path d="M8 4v8M4 8h8" /></svg>
              <input type="color" value={shownColor()}
                     oninput={(e) => setColor(e.currentTarget.value.toUpperCase())} aria-label="Custom color" />
            </label>
            {#each PRESETS as c (c)}
              <button class="preset" class:on={selColor().toUpperCase() === c}
                      style:background={c} onclick={() => setColor(c)} title={c} aria-label={c}></button>
            {/each}
          </div>
          <div class="hex-row">
            <input class="hex" bind:value={hexDraft} oninput={onHexInput} maxlength="7"
                   spellcheck="false" aria-label="Hex color" />
            <button class="hex-reset" onclick={() => setColor('')}
                    title={selected === 'bubble' ? 'Back to the skin\'s own colors' : 'Back to the default text color'}>Default</button>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  {#if dialog}
    <div class="confirm-backdrop mini edit-ui" role="presentation">
      <div class="confirm" role="dialog" aria-modal="true">
        {#if dialog === 'hide'}
          <div class="confirm-msg">BreathPause keeps running in the tray. Click the tray icon to show the bubble again.</div>
          <label class="dont-ask"><input type="checkbox" bind:checked={dontAsk} /> Don't show again</label>
          <div class="confirm-btns">
            <button class="cb cb-ok" onclick={confirmHide}>OK</button>
          </div>
        {:else}
          <div class="confirm-msg">Save your text changes?</div>
          <label class="dont-ask"><input type="checkbox" bind:checked={dontAsk} /> Always save, don't ask again</label>
          <div class="confirm-btns">
            <button class="cb cb-ok" onclick={() => answerSave(true)}>Save</button>
            <button class="cb cb-plain" onclick={() => answerSave(false)}>Discard</button>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if breaking && confirmLeave}
    <div class="confirm-backdrop" role="presentation">
      <div class="confirm" role="dialog" aria-modal="true">
        <div class="confirm-msg">Leave the break?</div>
        <div class="confirm-btns">
          <!-- svelte-ignore a11y_autofocus -->
          <button class="cb cb-yes" autofocus onclick={leaveBreak}>Yes</button>
          <button class="cb cb-no" onclick={cancelLeave}>No</button>
        </div>
      </div>
    </div>
  {/if}

  {#if skinError}<div class="error">{skinError}</div>{/if}
</main>

<style>
  main {
    position: relative;      /* anchors the hover buttons, edit rail and dialogs to the bubble */
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    /* Work bubble: skin anchored at the top so resizing grows downward (top stays at posTop). */
    justify-content: flex-start;
  }
  .stage {
    width: min(76vmin, 560px);
    height: min(76vmin, 560px);
  }
  .textblock {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .label {
    margin-top: 2px;
    font-size: 18px;
    letter-spacing: 3px;
    opacity: 0.9;
    min-height: 24px;
  }
  .pomo {
    font-size: 13px;
    letter-spacing: 2px;
    opacity: 0.65;
    min-height: 18px;
  }
  .error {
    position: fixed;
    bottom: 8px;
    font-size: 12px;
    color: #ff9d9d;
    opacity: 0.8;
  }

  /* ===== break overlay ===== */
  main.breaking {
    position: fixed;
    inset: 0;
    justify-content: center; /* break is fullscreen and centered */
    /* Fallback tint, visible only when there's no screenshot (browser dev, capture
       failure). The real frost is .break-bg below. */
    background: rgba(10, 12, 18, 0.45);
    isolation: isolate;      /* keep .break-bg's z-index:-1 inside the overlay */
  }
  .break-bg {
    position: fixed;
    /* Bleed past the edges: blur fades out at the element border, and the fade
       must land offscreen instead of as a dark vignette. */
    inset: -48px;
    z-index: -1;
    background-size: cover;
    background-position: center;
    /* Screenshot ships at half resolution, so 14px here ≈ a 28px blur.
       brightness replaces the old dark tint and keeps the light text readable. */
    filter: blur(14px) brightness(0.72) saturate(0.85);
  }
  .break-exit {
    position: fixed;
    top: 18px;
    right: 18px;
    width: 42px;
    height: 42px;
    border-radius: 11px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    z-index: 10;
  }
  .break-exit:hover {
    background: rgba(255, 255, 255, 0.16);
  }
  .confirm-backdrop {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.45);
    z-index: 20;
  }
  .confirm {
    background: #1c1c1e;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 14px;
    padding: 22px 24px;
    text-align: center;
    min-width: 260px;
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
  }
  .confirm-msg {
    color: #fff;
    font-size: 16px;
    margin-bottom: 18px;
  }
  .confirm-btns {
    display: flex;
    gap: 12px;
    justify-content: center;
  }
  .cb {
    flex: 1;
    padding: 10px 18px;
    border-radius: 9px;
    border: 0;
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    color: #fff;
    cursor: pointer;
  }
  /* ===== hover buttons + edit mode ===== */
  /* Theme tokens for the edit UI; follows the settings window's light/dark choice. */
  main {
    --ui-bg: rgba(22, 22, 26, 0.86);
    --ui-bg-hover: rgba(22, 22, 26, 0.97);
    --ui-card: #1c1c1e;
    --ui-fg: #f2f2f2;
    --ui-muted: #9aa0aa;
    --ui-line: rgba(255, 255, 255, 0.16);
    --ui-field: #2a2a2e;
    --ui-btn: #3a3a3f;
    --ui-accent: #4fc3f7;
  }
  main[data-theme="light"] {
    --ui-bg: rgba(251, 251, 253, 0.92);
    --ui-bg-hover: #ffffff;
    --ui-card: #f3f3f6;
    --ui-fg: #1a1a1f;
    --ui-muted: #5a5a63;
    --ui-line: rgba(0, 0, 0, 0.14);
    --ui-field: #ffffff;
    --ui-btn: #e2e2ea;
    --ui-accent: #0a6cc9;
  }
  .bubble-btns {
    position: absolute;
    top: 4px;
    right: 4px;
    display: none;
    gap: 4px;
    z-index: 5;
  }
  :global(body.hot) .bubble-btns, .bubble-btns.show { display: flex; }
  .bb {
    width: 26px;
    height: 26px;
    padding: 0;
    display: grid;
    place-items: center;
    border-radius: 7px;
    border: 1px solid var(--ui-line);
    background: var(--ui-bg);
    color: var(--ui-fg);
    cursor: pointer;
  }
  .bb:hover { background: var(--ui-bg-hover); }
  .bb svg, .preset.custom svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
    pointer-events: none;
  }
  /* Edit mode: the bubble is selectable, not draggable. */
  :global(body.hot) main.editing .stage, :global(body.hot) main.editing .stage :global(*) { cursor: pointer; }
  main.editing .stage { border-radius: 50%; }
  main.editing .stage.sel { outline: 1.5px solid var(--ui-accent); outline-offset: 3px; }
  main.editing .tline {
    cursor: move;
    border-radius: 4px;
    outline: 1px dashed rgba(255, 255, 255, 0.35);
    outline-offset: 2px;
    padding: 0 4px;
    user-select: none;
    touch-action: none;
  }
  main.editing .tline.sel { outline: 1.5px solid var(--ui-accent); }
  .side {
    position: absolute;
    top: 8px;
    box-sizing: border-box;
    width: 76px;             /* fixed, so the color panel beside it always fits EDIT_ROOM */
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px 6px;
    border-radius: 10px;
    background: var(--ui-bg);
    border: 1px solid var(--ui-line);
    color: var(--ui-fg);
    font: 11px 'Segoe UI', sans-serif;
    z-index: 6;
  }
  .side.right { left: calc(100% + 8px); }
  .side.left { right: calc(100% + 8px); }
  .side-cap, .side-val { opacity: 0.85; white-space: nowrap; }
  .rails { display: flex; gap: 2px; }
  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .rails .rail + .rail .side-cap { font-size: 10px; }   /* "Opacity" fits beside "Size" */
  .side button, .side input, .side label { cursor: pointer; }
  .vrange {
    writing-mode: vertical-lr;
    direction: rtl;
    width: 24px;             /* the whole width is the click target, not just the 6px track */
    height: 110px;
    margin: 0;
    accent-color: var(--ui-accent);
  }
  .swatch {
    width: 30px;
    height: 30px;
    padding: 0;
    border-radius: 50%;
    border: 2px solid var(--ui-line);
    box-shadow: 0 0 0 1px var(--ui-bg);
    cursor: pointer;
  }
  .parts {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 2px;
  }
  .part {
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
    cursor: pointer;
  }
  .part input { margin: 0; cursor: pointer; accent-color: var(--ui-accent); }
  .color-panel {
    position: absolute;
    top: 0;
    box-sizing: border-box;
    width: 190px;
    padding: 10px;
    border-radius: 10px;
    background: var(--ui-card);
    border: 1px solid var(--ui-line);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  }
  .side.right .color-panel { left: calc(100% + 8px); }
  .side.left .color-panel { right: calc(100% + 8px); }
  .presets {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 6px;
  }
  .preset {
    aspect-ratio: 1;
    padding: 0;
    border-radius: 6px;
    border: 1px solid var(--ui-line);
    cursor: pointer;
  }
  .preset.on { outline: 2px solid var(--ui-accent); outline-offset: 1px; }
  .preset.custom {
    position: relative;
    display: grid;
    place-items: center;
    color: #fff;
    background: conic-gradient(#ef476f, #ffd166, #06d6a0, #118ab2, #8e7dff, #ef476f);
  }
  .preset.custom input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;              /* the tile is the look; the input underneath opens the picker */
    cursor: pointer;
  }
  .hex-row {
    display: flex;
    gap: 6px;
    margin-top: 10px;
  }
  .hex {
    flex: 1;
    min-width: 0;
    padding: 5px 7px;
    border-radius: 6px;
    border: 1px solid var(--ui-line);
    background: var(--ui-field);
    color: var(--ui-fg);
    font: 12px ui-monospace, Consolas, monospace;
  }
  .hex-reset {
    padding: 5px 8px;
    border-radius: 6px;
    border: 0;
    background: var(--ui-btn);
    color: var(--ui-fg);
    font: 11px 'Segoe UI', sans-serif;
    cursor: pointer;
  }
  /* Dialogs on the small bubble: no screen tint (it'd paint the transparent window
     rectangle), card sized to fit the bubble. */
  .confirm-backdrop.mini {
    position: absolute;
    background: transparent;
  }
  .confirm-backdrop.mini .confirm {
    min-width: 0;
    width: calc(100% - 16px);
    max-width: 260px;
    padding: 14px;
    font-family: 'Segoe UI', sans-serif;
    background: var(--ui-card);
    border-color: var(--ui-line);
  }
  .confirm-backdrop.mini .confirm-msg {
    font-size: 12.5px;
    margin-bottom: 10px;
    line-height: 1.35;
    color: var(--ui-fg);
  }
  .dont-ask {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin-bottom: 12px;
    color: var(--ui-muted);
    font-size: 11.5px;
  }
  .confirm-backdrop.mini .cb { padding: 7px 12px; font-size: 12.5px; }
  .cb-ok { background: var(--ui-accent); }
  main[data-theme="dark"] .cb-ok { color: #06222c; }
  .cb-plain { background: var(--ui-btn); color: var(--ui-fg); }
  .cb-yes { background: #e05252; }   /* default answer = leave */
  .cb-yes:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  .cb-no  { background: #4caf72; }
</style>
