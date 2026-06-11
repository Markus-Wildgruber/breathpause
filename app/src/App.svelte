<script>
  import { onMount } from 'svelte';
  import Breathing from './core/breathing.js';
  import Pomodoro from './core/pomodoro.js';
  import Timefmt from './core/timefmt.js';
  import { loadSkin, loadSkinById, mountSkin } from './lib/skin.js';
  import { setupHoverDrag } from './lib/interactivity.js';
  import { loadSettings, modeKey } from './lib/settings-store.js';

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

  // Convert settings pattern (in/out/hold) to Breathing.js pattern (inhale/exhale/hold)
  function buildPattern(mode) {
    const patternId = mode === 'work' ? settings.timers.workPattern : settings.timers.breakPattern;
    const sp = (settings.patterns || []).find(p => p.id === patternId) || settings.patterns?.[0];
    if (!sp) {
      return { phases: [{ type: 'inhale', seconds: 5.5, label: 'breathe in' }, { type: 'exhale', seconds: 5.5, label: 'breathe out' }] };
    }
    const labels = settings.text?.phases || { in: 'breathe in', out: 'breathe out', hold: 'hold' };
    return {
      phases: sp.phases.map(ph => ({
        type: ph.type === 'in' ? 'inhale' : ph.type === 'out' ? 'exhale' : 'hold',
        seconds: ph.seconds,
        label: labels[ph.type] || ph.type,
      })),
    };
  }

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

  async function resizeForMode() {
    if (!('__TAURI_INTERNALS__' in window)) return;
    const { getCurrentWindow, LogicalSize, LogicalPosition } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    const winW = ap.sizePx + 40;
    const winH = ap.sizePx + 80;
    const dpr = window.devicePixelRatio || 1;
    const screenW = window.screen.availWidth / dpr;
    const x = Math.max(0, screenW - winW - (ap.posRight ?? 40));
    const y = Math.max(0, ap.posTop ?? 40);
    await win.setSize(new LogicalSize(winW, winH));
    await win.setPosition(new LogicalPosition(x, y));
  }

  async function showMode(mode) {
    currentMode = mode;
    ap = settings.appearance[modeKey(mode)];
    const skin = await skinFor(mode);
    textColor = ap.textColor || skin.manifest.text?.color || '#eef6ff';
    mounted = mountSkin(stage, skin);
    await resizeForMode();
  }

  function newPomo() {
    const t = settings.timers;
    return Pomodoro.initState(t.workSeconds, t.breakSeconds, t.longBreakSeconds, t.longBreakEvery, true);
  }

  onMount(async () => {
    let pomo = newPomo();
    let paused = false;

    if ('__TAURI_INTERNALS__' in window) {
      document.body.classList.add('tauri');
      setupHoverDrag();
      const { listen } = await import('@tauri-apps/api/event');
      listen('toggle-pause', () => {
        paused = !paused;
        pomo = paused ? Pomodoro.pause(pomo) : Pomodoro.resume(pomo);
      });
      listen('settings-changed', async () => {
        // Invalidate skin cache so new skin picks are loaded
        for (const k of Object.keys(skins)) delete skins[k];
        settings = loadSettings();
        pomo = newPomo();
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
      if (r.events?.some(ev => ev === 'work_complete' || ev === 'break_complete')) playChime();
      pomo = r.state;
      if (pomo.mode !== currentMode) {
        breathT = 0;
        showMode(pomo.mode);
      }

      const pattern = buildPattern(currentMode);
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

<main style:font-family={ap.font}>
  <div class="stage" bind:this={stage}
       style:width="{ap.sizePx}px" style:height="{ap.sizePx}px" style:opacity={ap.opacity}></div>
  <div class="textblock" style:transform="translate({ap.textOffsetX ?? 0}px, {ap.textOffsetY ?? 0}px)">
    <div class="label" style:color={textColor} style:font-size="{ap.labelSize}px">{[label, phaseCountdown].filter(Boolean).join(' ')}</div>
    <div class="pomo" style:color={textColor}>{[pomoText, sessionsText].filter(Boolean).join('  ')}</div>
  </div>
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
</style>
