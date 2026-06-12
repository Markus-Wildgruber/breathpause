<script>
  import { onMount } from 'svelte';
  import Breathing from './core/breathing.js';
  import Pomodoro from './core/pomodoro.js';
  import Timefmt from './core/timefmt.js';
  import Pattern from './core/pattern.js';
  import { loadSkin, loadSkinById, mountSkin } from './lib/skin.js';
  import { setupHoverDrag, setHoverDragActive } from './lib/interactivity.js';
  import { loadSettings, saveSettings, mergePatch, modeKey } from './lib/settings-store.js';

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

  function newPomo() {
    const t = settings.timers;
    return Pomodoro.initState(t.workSeconds, t.breakSeconds, t.longBreakSeconds, t.longBreakEvery, true);
  }

  onMount(async () => {
    pomo = newPomo();
    paused = false;

    // Esc opens the leave-break confirmation; Enter confirms it (default = leave).
    window.addEventListener('keydown', (e) => {
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
        const argv = await invoke('launch_args');
        const ai = argv.indexOf('--apply-settings');
        if (ai >= 0 && argv[ai + 1]) {
          saveSettings(mergePatch(loadSettings(), JSON.parse(argv[ai + 1])));
          settings = loadSettings();
          pomo = Pomodoro.applyConfig(pomo, settings.timers);
        }
        if (argv.includes('--settings')) emit('open-settings');
      } catch (e) {
        console.warn('launch args:', e);
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

<main class:breaking style:font-family={ap.font}>
  {#if breaking && breakShot}
    <div class="break-bg" style:background-image="url({breakShot})"></div>
  {/if}
  {#if breaking}
    <button class="break-exit" onclick={requestLeave} title="Leave break" aria-label="Leave break">✕</button>
  {/if}

  <div class="stage" bind:this={stage}
       style:width={breaking ? `${ap.sizePct ?? 45}vh` : `${ap.sizePx}px`}
       style:height={breaking ? `${ap.sizePct ?? 45}vh` : `${ap.sizePx}px`}
       style:opacity={ap.opacity}></div>
  <div class="textblock" style:transform="translate({ap.textOffsetX ?? 0}px, {ap.textOffsetY ?? 0}px)">
    <div class="label" style:color={textColor} style:font-size="{ap.labelSize}px">{[label, phaseCountdown].filter(Boolean).join(' ')}</div>
    <div class="pomo" style:color={textColor} style:font-size="{ap.subSize}px">{[pomoText, sessionsText].filter(Boolean).join('  ')}</div>
  </div>

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
  .cb-yes { background: #e05252; }   /* default answer = leave */
  .cb-yes:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  .cb-no  { background: #4caf72; }
</style>
