<script>
  import { onMount } from 'svelte';
  import Breathing from './core/breathing.js';
  import Pomodoro from './core/pomodoro.js';
  import Timefmt from './core/timefmt.js';
  import Pattern from './core/pattern.js';
  import { loadSkin, loadSkinById, mountSkin } from './lib/skin.js';
  import { setupHoverDrag, setHoverDragActive } from './lib/interactivity.js';
  import { loadSettings, saveSettings, modeKey } from './lib/settings-store.js';

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
    const { getCurrentWindow, LogicalSize, LogicalPosition } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    if (mode === 'break') {
      await setHoverDragActive(false);     // pause hover-drag, make the overlay clickable
      await win.setFullscreen(true);
      await win.setFocus();                // so Esc/Enter reach the window
      return;
    }
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
      listen('toggle-pause', () => {
        paused = !paused;
        pomo = paused ? Pomodoro.pause(pomo) : Pomodoro.resume(pomo);
        emit('paused-changed', { paused });   // let the tray menu show Pause vs Resume
      });
      listen('settings-changed', async () => {
        // Invalidate skin cache so new skin picks are loaded
        for (const k of Object.keys(skins)) delete skins[k];
        settings = loadSettings();
        pomo = newPomo();
        await showMode(pomo.mode);
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
    background: rgba(10, 12, 18, 0.82);
    backdrop-filter: blur(22px);
    -webkit-backdrop-filter: blur(22px);
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
