<script>
  // Bubble window: renders the selected skin and drives it with the breathing core.
  // ?skin=<name> picks a bundled skin (default: orb); a broken skin falls back to orb.
  import { onMount } from 'svelte';
  import Breathing from './core/breathing.js';
  import { loadSkin, mountSkin } from './lib/skin.js';

  const DEFAULT_PATTERN = {
    phases: [
      { type: 'inhale', seconds: 5.5, label: 'breathe in' },
      { type: 'exhale', seconds: 5.5, label: 'breathe out' },
    ],
  };

  let stage;                       // skin container element
  let label = $state('');
  let textColor = $state('#eef6ff');
  let skinError = $state('');

  onMount(async () => {
    const wanted = new URLSearchParams(location.search).get('skin') || 'orb';
    let skin;
    try {
      skin = await loadSkin(`skins/${wanted}`);
    } catch (e) {
      skinError = `${e.message} — falling back to orb`;   // becomes an eventlog line in the Tauri shell
      console.warn('skin load failed:', e);
      skin = await loadSkin('skins/orb');
    }
    textColor = skin.manifest.text?.color || textColor;
    const mounted = mountSkin(stage, skin);

    const start = performance.now();
    function frame(now) {
      const t = (now - start) / 1000;
      const breath = Breathing.sizeAt(DEFAULT_PATTERN, t);
      mounted.apply({ breath, time: Math.sin(t) });
      label = Breathing.currentLabel(DEFAULT_PATTERN, t);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
</script>

<main>
  <div class="stage" bind:this={stage}></div>
  <div class="label" style:color={textColor}>{label}</div>
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
    width: min(80vmin, 560px);
    height: min(80vmin, 560px);
  }
  .label {
    margin-top: 4px;
    font-size: 20px;
    letter-spacing: 3px;
    opacity: 0.9;
    min-height: 28px;
  }
  .error {
    position: fixed;
    bottom: 8px;
    font-size: 12px;
    color: #ff9d9d;
    opacity: 0.8;
  }
</style>
