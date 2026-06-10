<script>
  // Bubble window: renders the per-mode skin and drives it with the breathing core,
  // while the pomodoro core tracks work/break segments.
  // ?skin=<name> forces one skin for all modes (preview); default is per-mode config.
  import { onMount } from 'svelte';
  import Breathing from './core/breathing.js';
  import Pomodoro from './core/pomodoro.js';
  import Timefmt from './core/timefmt.js';
  import { loadSkin, mountSkin } from './lib/skin.js';
  import { setupHoverDrag } from './lib/interactivity.js';
  import { loadSettings } from './lib/settings-store.js';

  // breathing patterns per mode (pattern editor still on the roadmap)
  const PATTERNS = {
    work: { phases: [
      { type: 'inhale', seconds: 5.5, label: 'breathe in' },
      { type: 'exhale', seconds: 5.5, label: 'breathe out' },
    ] },
    break: { phases: [
      { type: 'inhale', seconds: 4, label: 'breathe in' },
      { type: 'hold',   seconds: 4, label: 'hold' },
      { type: 'exhale', seconds: 6, label: 'breathe out' },
    ] },
  };

  let settings = $state(loadSettings());

  let stage;
  let label = $state('');
  let pomoText = $state('');
  let textColor = $state('#eef6ff');
  let skinError = $state('');

  const forced = new URLSearchParams(location.search).get('skin');
  const skins = {};            // mode -> loaded skin
  let mounted = null;
  let currentMode = null;

  async function skinFor(mode) {
    const name = forced || settings.skins[mode] || 'orb';
    if (!skins[name]) {
      try {
        skins[name] = await loadSkin(`skins/${name}`);
      } catch (e) {
        skinError = `${e.message} — falling back to orb`;
        console.warn('skin load failed:', e);
        skins[name] = await loadSkin('skins/orb');
      }
    }
    return skins[name];
  }

  async function showMode(mode) {
    currentMode = mode;
    const skin = await skinFor(mode);
    textColor = settings.appearance.textColor || skin.manifest.text?.color || '#eef6ff';
    mounted = mountSkin(stage, skin);
  }

  function newPomo() {
    const t = settings.timers;
    return Pomodoro.initState(t.workSeconds, t.breakSeconds, t.longBreakSeconds,
      t.longBreakEvery, t.autoContinue);
  }

  onMount(async () => {
    let pomo = newPomo();
    let paused = false;

    if ('__TAURI_INTERNALS__' in window) {
      document.body.classList.add('tauri');
      setupHoverDrag();   // click-through; hover ~1.6s to grab & move
      const { listen } = await import('@tauri-apps/api/event');
      listen('toggle-pause', () => {
        paused = !paused;
        pomo = paused ? Pomodoro.pause(pomo) : Pomodoro.resume(pomo);
      });
      listen('settings-changed', async () => {
        settings = loadSettings();
        pomo = newPomo();                  // durations changed -> restart the cycle
        await showMode(pomo.mode);
      });
    }
    await showMode(pomo.mode);

    const start = performance.now();
    let last = start;
    let breathT = 0;

    function frame(now) {
      const dt = Pomodoro.limitFrameDt ? Pomodoro.limitFrameDt((now - last) / 1000) : (now - last) / 1000;
      last = now;

      const r = Pomodoro.tick(pomo, dt);
      pomo = r.state;
      if (pomo.mode !== currentMode) {
        breathT = 0;                       // restart the breath cycle on mode switch
        showMode(pomo.mode);
      }

      const pattern = PATTERNS[currentMode] || PATTERNS.work;
      if (!paused) breathT += dt;
      const breath = Breathing.sizeAt(pattern, breathT);
      mounted?.apply({ breath, time: Math.sin(breathT) });
      label = paused ? 'paused'
        : settings.appearance.showPhaseLabel ? Breathing.currentLabel(pattern, breathT) : '';
      pomoText = settings.appearance.showPomodoro
        ? `${pomo.mode === 'work' ? 'work' : 'break'} ${Timefmt.formatRemaining(pomo.remaining)}`
        : '';
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
</script>

<main style:font-family={settings.appearance.font}>
  <div class="stage" bind:this={stage} style:opacity={settings.appearance.opacity}></div>
  <div class="label" style:color={textColor}>{label}</div>
  <div class="pomo" style:color={textColor}>{pomoText}</div>
  {#if skinError}<div class="error">{skinError}</div>{/if}
</main>

<style>
  main {
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .stage {
    width: min(76vmin, 560px);
    height: min(76vmin, 560px);
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
</style>
