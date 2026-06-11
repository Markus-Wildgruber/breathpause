<script>
  import { onMount } from 'svelte';
  import Timefmt from './core/timefmt.js';
  import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './lib/settings-store.js';
  import { loadSkinById, mountSkin } from './lib/skin.js';

  const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  let s = $state(loadSettings());
  // Saved theme wins; OS theme is the fallback
  const osTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  let theme = $state(s.theme || osTheme);
  let version = $state('0.1.0');
  if (inTauri) {
    import('@tauri-apps/api/app').then(({ getVersion }) => getVersion().then(v => version = v));
  }
  let pane = $state('appearance');
  let mode = $state('work');
  let ap = $derived(s.appearance[mode]);
  let apSub = $state('skin');

  // Searchable font picker
  const FONTS = [
    'Segoe UI Variable', 'Segoe UI', 'Calibri', 'Arial', 'Verdana', 'Tahoma',
    'Trebuchet MS', 'Georgia', 'Times New Roman', 'Cambria', 'Constantia', 'Corbel',
    'Candara', 'Consolas', 'Courier New', 'Lucida Sans', 'Lucida Console',
    'Palatino Linotype', 'Franklin Gothic', 'Century Gothic', 'Comic Sans MS',
    'Impact', 'Ebrima', 'Bahnschrift', 'Sitka Text', 'Ink Free', 'system-ui',
  ];
  let fontOpen = $state(false);
  let fontSearch = $state('');
  let fontMatches = $derived(FONTS.filter(f => f.toLowerCase().includes(fontSearch.toLowerCase())));

  const NAV = [
    { id: 'appearance', label: 'Appearance' },
    { id: 'patterns',   label: 'Patterns'   },
    { id: 'timers',     label: 'Timers'     },
    { id: 'skins',      label: 'Skins'      },
    { id: 'behavior',   label: 'Behavior'   },
    { id: 'text',       label: 'Text'       },
    { id: 'about',      label: 'About'      },
  ];

  const BUNDLED_SKINS = [
    { id: 'orb',         name: 'Classic Orb'  },
    { id: 'sleepy-seal', name: 'Sleepy Seal'  },
  ];

  let allSkins = $derived([
    ...BUNDLED_SKINS,
    ...(s.customSkins || []).map(cs => ({ id: cs.id, name: cs.name, custom: true })),
  ]);

  // Work: hh:mm; break/long: mm:ss
  function fmtWork(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return Timefmt.pad2(h) + ':' + Timefmt.pad2(m);
  }
  function fmt(sec) { return Timefmt.formatRemaining(sec); }

  let workTxt  = $state(fmtWork(s.timers.workSeconds));
  let breakTxt = $state(fmt(s.timers.breakSeconds));
  let longTxt  = $state(fmt(s.timers.longBreakSeconds));

  function numOnly(e) { e.target.value = e.target.value.replace(/[^0-9:]/g, ''); }

  // ---- pattern helpers ----
  function phaseSummary(phases) {
    return phases.map(p => `${p.seconds}s ${p.type}`).join(' → ');
  }

  async function openPatternEditorFor(p) {
    localStorage.setItem('breathpause.patternDraft', JSON.stringify({
      pattern: $state.snapshot(p),
      isNew: false,
    }));
    if (inTauri) {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('open-pattern-editor');
    }
  }

  async function openNewPatternWindow() {
    localStorage.setItem('breathpause.patternDraft', JSON.stringify({
      pattern: { id: 'p' + Date.now(), name: '', phases: [{ type: 'in', seconds: 4 }] },
      isNew: true,
    }));
    if (inTauri) {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('open-pattern-editor');
    }
  }

  // ---- skin import ----
  let importTrigger = $state(null);
  let importingName = $state(null);
  let importingSvg  = $state(null);

  function onImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      importingSvg  = ev.target.result;
      importingName = file.name.replace(/\.svg$/i, '');
      e.target.value = '';
    };
    reader.readAsText(file);
  }

  function confirmImport() {
    if (!importingName?.trim() || !importingSvg) return;
    if (!s.customSkins) s.customSkins = [];
    s.customSkins.push({ id: 'custom-' + Date.now(), name: importingName.trim(), svgText: importingSvg });
    importingName = null;
    importingSvg  = null;
  }

  function deleteCustomSkin(id) {
    s.customSkins = s.customSkins.filter(cs => cs.id !== id);
    if (s.appearance.work.skin  === id) s.appearance.work.skin  = 'orb';
    if (s.appearance.break.skin === id) s.appearance.break.skin = 'orb';
  }

  // Svelte action: animated skin preview. opts can be a skinId string or { skinId, fill }.
  // When fill is provided and the skin declares a themeColor, the fill is palette-applied in memory.
  function previewSkin(el, opts) {
    let skinId = typeof opts === 'string' ? opts : opts.skinId;
    let fill   = typeof opts === 'string' ? null  : opts.fill;
    let runId = 0, raf = null;

    async function load() {
      const myRun = ++runId;
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      try {
        const skin = await loadSkinById(skinId, s.customSkins);
        if (myRun !== runId || !el.isConnected) return;
        const pal = (fill && skin.manifest.themeColor) ? { [skin.manifest.themeColor]: fill } : {};
        const mounted = mountSkin(el, skin, Object.keys(pal).length ? { palette: pal } : {});
        let t = 0, last = performance.now();
        function loop(now) {
          if (myRun !== runId) return;
          t += (now - last) / 1000; last = now;
          mounted.apply({ breath: Math.sin(t * 0.7) * 0.5 + 0.5, time: Math.sin(t) });
          raf = requestAnimationFrame(loop);
        }
        raf = requestAnimationFrame(loop);
      } catch (e) { console.warn('skin preview failed:', skinId, e); }
    }

    load();
    return {
      update(newOpts) {
        const nId   = typeof newOpts === 'string' ? newOpts : newOpts.skinId;
        const nFill = typeof newOpts === 'string' ? null    : newOpts.fill;
        if (nId !== skinId || nFill !== fill) { skinId = nId; fill = nFill; load(); }
      },
      destroy() { runId++; if (raf) cancelAnimationFrame(raf); },
    };
  }

  function buildPalette(skin, fill) {
    if (!skin?.manifest?.themeColor || !fill) return {};
    return { [skin.manifest.themeColor]: fill };
  }

  // ---- appearance preview ----
  let previewBox = $state();
  let previewMounted = null;

  $effect(() => {
    const name = ap.skin || 'orb';
    const fill = ap.fill;
    if (!previewBox) return;
    let cancelled = false;
    (async () => {
      let skin;
      try { skin = await loadSkinById(name, s.customSkins); }
      catch { skin = await loadSkinById('orb', []); }
      if (!cancelled && previewBox) {
        const pal = buildPalette(skin, fill);
        previewMounted = mountSkin(previewBox, skin, Object.keys(pal).length ? { palette: pal } : {});
      }
    })();
    return () => { cancelled = true; };
  });

  async function emitChanged() {
    if (!inTauri) return;
    const { emit } = await import('@tauri-apps/api/event');
    await emit('settings-changed');
  }

  async function close() {
    if (!inTauri) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  }

  function applyDurations() {
    const w = Timefmt.parseWorkSeconds(workTxt);
    const b = Timefmt.parseBreakSeconds(breakTxt);
    const l = Timefmt.parseBreakSeconds(longTxt);
    if (w) s.timers.workSeconds = w;
    if (b) s.timers.breakSeconds = b;
    if (l) s.timers.longBreakSeconds = l;
  }

  async function onSave() {
    applyDurations();
    const snap = $state.snapshot(s);
    saveSettings(snap);
    await emitChanged();
    if (inTauri) {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('apply-tray-text', snap.text.tray);
    }
    await close();
  }

  function onReset() {
    s = structuredClone(DEFAULT_SETTINGS);
    theme = s.theme || osTheme;
    workTxt  = fmtWork(s.timers.workSeconds);
    breakTxt = fmt(s.timers.breakSeconds);
    longTxt  = fmt(s.timers.longBreakSeconds);
  }

  async function openExternal(url) {
    if (inTauri) {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  async function onExit() {
    if (!inTauri) return;
    const { emit } = await import('@tauri-apps/api/event');
    await emit('app-quit');
  }

  onMount(() => {
    document.body.classList.add('settings-body');
    let t = 0, last = performance.now(), raf;
    function loop(now) {
      t += (now - last) / 1000; last = now;
      previewMounted?.apply({ breath: Math.sin(t * 0.7) * 0.5 + 0.5, time: Math.sin(t) });
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    let unlisten = null;
    let unlistenMove = null;
    if (inTauri) {
      (async () => {
        const { restoreWindowPosition, trackWindowPosition } = await import('./lib/window-state.js');
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        await restoreWindowPosition('settings', win);
        unlistenMove = await trackWindowPosition('settings', win);

        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen('pattern-editor-saved', () => {
          try {
            const result = JSON.parse(localStorage.getItem('breathpause.patternResult'));
            if (!result) return;
            if (result.deleted) {
              s.patterns = s.patterns.filter(p => p.id !== result.id);
              if (s.timers.workPattern  === result.id) s.timers.workPattern  = s.patterns[0]?.id ?? '';
              if (s.timers.breakPattern === result.id) s.timers.breakPattern = s.patterns[0]?.id ?? '';
            } else {
              const idx = s.patterns.findIndex(p => p.id === result.id);
              if (idx >= 0) s.patterns[idx] = result;
              else s.patterns.push(result);
            }
          } catch {}
        });
      })();
    }

    return () => {
      cancelAnimationFrame(raf);
      unlisten?.();
      unlistenMove?.();
    };
  });

  function previewSize(px) { return Math.round(Math.max(40, px / 4)); }
</script>

{#snippet themeBtn()}
  <div class="seg">
    <button class:on={theme === 'light'} title="Light" onclick={() => { theme = 'light'; s.theme = 'light'; }}>☀</button>
    <button class:on={theme === 'dark'}  title="Dark"  onclick={() => { theme = 'dark'; s.theme = 'dark'; }}>☾</button>
  </div>
{/snippet}

<div class="win" data-theme={theme}>
  <div class="body">
    <div class="rail">
      {#each NAV as n}
        <div class="navitem" class:sel={pane === n.id} role="button" tabindex="0"
             onclick={() => pane = n.id} onkeydown={(e) => e.key === 'Enter' && (pane = n.id)}>
          {n.label}
        </div>
      {/each}
    </div>

    <!-- ===== TIMERS ===== -->
    {#if pane === 'timers'}
      <div class="pane">
        <div class="panehead"><h2>Timers</h2>{@render themeBtn()}</div>
        <div class="card">
          <div class="ch">Durations</div>
          <div class="row"><label for="wt">Work (hh:mm)</label>
            <input id="wt" class="ctl" bind:value={workTxt} oninput={numOnly}></div>
          <div class="row"><label for="bt">Break (mm:ss)</label>
            <input id="bt" class="ctl" bind:value={breakTxt} oninput={numOnly}></div>
          <div class="row"><label for="lt">Long break (mm:ss)</label>
            <input id="lt" class="ctl" bind:value={longTxt} oninput={numOnly}></div>
        </div>
        <div class="card">
          <div class="ch">Cycle</div>
          <div class="row"><label for="lbe">Long break every N sessions (0 = off)</label>
            <input id="lbe" class="ctl" type="number" min="0" max="12" bind:value={s.timers.longBreakEvery}></div>
        </div>
      </div>

    <!-- ===== PATTERNS ===== -->
    {:else if pane === 'patterns'}
      <div class="pane">
        <div class="panehead"><h2>Patterns</h2>{@render themeBtn()}</div>

        <div class="card">
          <div class="ch">Selection</div>
          <div class="row"><label for="wp">Work pattern</label>
            <select id="wp" class="ctl" bind:value={s.timers.workPattern}>
              {#each s.patterns as p}<option value={p.id}>{p.name}</option>{/each}
            </select></div>
          <div class="row"><label for="bp">Break pattern</label>
            <select id="bp" class="ctl" bind:value={s.timers.breakPattern}>
              {#each s.patterns as p}<option value={p.id}>{p.name}</option>{/each}
            </select></div>
        </div>

        <div class="gallery">
          {#each s.patterns as p}
            <div class="gitem" role="button" tabindex="0"
                 onclick={() => openPatternEditorFor(p)}
                 onkeydown={(e) => e.key === 'Enter' && openPatternEditorFor(p)}>
              <div class="gname">{p.name}</div>
              <div class="gsummary">{phaseSummary(p.phases)}</div>
            </div>
          {/each}
          <div class="gitem gadd" role="button" tabindex="0"
               onclick={openNewPatternWindow}
               onkeydown={(e) => e.key === 'Enter' && openNewPatternWindow()}>
            <div class="gplus">+</div>
            <div class="gsummary">New pattern</div>
          </div>
        </div>
        <div class="hint">Click a pattern to edit it in a new window. Changes appear here after saving.</div>
      </div>

    <!-- ===== SKINS ===== -->
    {:else if pane === 'skins'}
      <div class="pane">
        <div class="panehead"><h2>Skins</h2>{@render themeBtn()}</div>

        <div class="gallery skin-gallery">
          {#each allSkins as sk (sk.id)}
            <div class="gitem skin-gitem">
              <div class="skin-preview" use:previewSkin={sk.id}></div>
              <div class="gname">{sk.name}</div>
              <div class="skin-modes">
                <button class="skin-btn" class:on={s.appearance.work.skin === sk.id}
                        onclick={() => s.appearance.work.skin = sk.id}>Work</button>
                <button class="skin-btn" class:on={s.appearance.break.skin === sk.id}
                        onclick={() => s.appearance.break.skin = sk.id}>Break</button>
              </div>
              {#if sk.custom}
                <button class="skin-del-btn" onclick={() => deleteCustomSkin(sk.id)}>Delete</button>
              {/if}
            </div>
          {/each}

          <div class="gitem gadd skin-gadd" role="button" tabindex="0"
               onclick={() => importTrigger?.click()}
               onkeydown={(e) => e.key === 'Enter' && importTrigger?.click()}>
            <div class="gplus">+</div>
            <div class="gsummary">Import SVG skin</div>
          </div>
        </div>

        <input bind:this={importTrigger} type="file" accept=".svg" style:display="none"
               onchange={onImportFile}>

        {#if importingName !== null}
          <div class="card">
            <div class="ch">Name your skin</div>
            <div class="row"><label for="iname">Name</label>
              <input id="iname" class="ctl" bind:value={importingName} placeholder="My skin"></div>
            <div class="editor-foot">
              <span class="spacer"></span>
              <button class="btn" onclick={() => { importingName = null; importingSvg = null; }}>Cancel</button>
              <button class="btn primary" onclick={confirmImport}>Add skin</button>
            </div>
          </div>
        {/if}
      </div>

    <!-- ===== APPEARANCE ===== -->
    {:else if pane === 'appearance'}
      <div class="pane">
        <div class="panehead"><h2>Appearance</h2>{@render themeBtn()}</div>

        <div class="modeseg">
          <button class:on={mode === 'work'}  onclick={() => mode = 'work'}>Work</button>
          <button class:on={mode === 'break'} onclick={() => mode = 'break'}>Break</button>
        </div>

        <div class="apsubseg">
          <button class:on={apSub === 'skin'} onclick={() => apSub = 'skin'}>Skin</button>
          <button class:on={apSub === 'text'} onclick={() => apSub = 'text'}>Text</button>
        </div>

        <div class="card preview">
          {#if apSub === 'skin'}
            <div class="orbside">
              <div class="orb" bind:this={previewBox}
                   style:width="{previewSize(ap.sizePx)}px" style:height="{previewSize(ap.sizePx)}px"
                   style:opacity={ap.opacity}></div>
            </div>
            <div class="psg">
              {#each allSkins as sk (sk.id)}
                <div class="psg-item" class:selected={ap.skin === sk.id}
                     role="button" tabindex="0"
                     onclick={() => ap.skin = sk.id}
                     onkeydown={(e) => e.key === 'Enter' && (ap.skin = sk.id)}>
                  <div class="psg-preview" use:previewSkin={{ skinId: sk.id, fill: ap.fill }}></div>
                  <div class="psg-name">{sk.name}</div>
                </div>
              {/each}
            </div>
          {:else}
            <div class="text-sample" style:font-family={ap.font}>
              <div class="ts-big" style:color={ap.textColor} style:font-size="{ap.labelSize}px">
                {[ap.showPhaseLabel && s.text.phases.in, ap.showPhaseCountdown && '4'].filter(Boolean).join(' ')}
              </div>
              <div class="ts-small" style:color={ap.textColor}>
                {[ap.showPomodoro && '24:18', ap.showSessions && '[2]'].filter(Boolean).join('  ')}
              </div>
            </div>
            <div class="text-quick">
              <div class="tq-row">
                <div class="fontdd" class:open={fontOpen}>
                  <button type="button" class="ctl fontdd-btn" style:font-family={ap.font}
                          onclick={() => { fontOpen = !fontOpen; fontSearch = ''; }}>
                    <span class="fontdd-cur">{ap.font}</span>
                    <span class="fontdd-caret">▾</span>
                  </button>
                  {#if fontOpen}
                    <div class="fontdd-backdrop" role="presentation" onclick={() => fontOpen = false}></div>
                    <div class="fontdd-panel">
                      <!-- svelte-ignore a11y_autofocus -->
                      <input class="fontdd-search" placeholder="Search fonts…" bind:value={fontSearch} autofocus>
                      <div class="fontdd-list">
                        {#each fontMatches as f}
                          <div class="fontdd-opt" class:sel={ap.font === f} style:font-family={f}
                               role="button" tabindex="0"
                               onclick={() => { ap.font = f; fontOpen = false; }}
                               onkeydown={(e) => e.key === 'Enter' && (ap.font = f, fontOpen = false)}>{f}</div>
                        {/each}
                        {#if fontMatches.length === 0}<div class="fontdd-empty">No matches</div>{/if}
                      </div>
                    </div>
                  {/if}
                </div>
              </div>
              <div class="tq-row">
                <div class="sliderwrap tq-slider">
                  <input type="range" min="10" max="32" bind:value={ap.labelSize}>
                  <span class="sval">{ap.labelSize}px</span>
                </div>
              </div>
              <div class="tq-row">
                <div class="colorrow"><input type="color" class="swatch" bind:value={ap.textColor}><input class="ctl small" bind:value={ap.textColor}></div>
              </div>
            </div>
          {/if}
        </div>

        {#if apSub === 'skin'}
          <div class="card">
            <div class="ch">Orb</div>
            <div class="row"><label for="sz">Size</label>
              <div class="sliderwrap"><input id="sz" type="range" min="60" max="480" bind:value={ap.sizePx}><span class="sval">{ap.sizePx}px</span></div></div>
            <div class="row"><label for="op">Opacity</label>
              <div class="sliderwrap"><input id="op" type="range" min="20" max="100" bind:value={
                () => Math.round(ap.opacity * 100), (v) => ap.opacity = v / 100
              }><span class="sval">{Math.round(ap.opacity * 100)}%</span></div></div>
            <div class="row"><label for="fl">Fill color</label>
              <div class="colorrow"><input type="color" class="swatch" bind:value={ap.fill}><input id="fl" class="ctl small" bind:value={ap.fill}></div></div>
          </div>

          <div class="card">
            <div class="ch">Position</div>
            <div class="row"><label for="pr">From right edge (px)</label>
              <input id="pr" class="ctl" type="number" min="0" max="3000" bind:value={ap.posRight}></div>
            <div class="row"><label for="pt">From top edge (px)</label>
              <input id="pt" class="ctl" type="number" min="0" max="3000" bind:value={ap.posTop}></div>
          </div>
        {/if}

        {#if apSub === 'text'}
          <div class="card">
            <div class="ch">Display</div>
            <label class="chk"><input type="checkbox" bind:checked={ap.showPhaseLabel}>Show phase label</label>
            <label class="chk"><input type="checkbox" bind:checked={ap.showPhaseCountdown}>Show phase countdown</label>
            <label class="chk"><input type="checkbox" bind:checked={ap.showPomodoro}>Show pomodoro time</label>
            <label class="chk"><input type="checkbox" bind:checked={ap.showSessions}>Show sessions until long break</label>
          </div>

          <div class="card">
            <div class="ch">Position</div>
            <div class="row"><label for="txx">Horizontal offset (px)</label>
              <input id="txx" class="ctl" type="number" min="-1000" max="1000" bind:value={ap.textOffsetX}></div>
            <div class="row"><label for="txy">Vertical offset (px)</label>
              <input id="txy" class="ctl" type="number" min="-1000" max="1000" bind:value={ap.textOffsetY}></div>
          </div>
        {/if}
      </div>

    <!-- ===== BEHAVIOR ===== -->
    {:else if pane === 'behavior'}
      <div class="pane">
        <div class="panehead"><h2>Behavior</h2>{@render themeBtn()}</div>
        <div class="card">
          <div class="ch">General</div>
          <label class="chk"><input type="checkbox" bind:checked={s.behavior.startOnBoot}>Start on boot</label>
          <label class="chk"><input type="checkbox" bind:checked={s.behavior.chimeOnTransitions}>Chime on transitions</label>
        </div>
        <div class="card">
          <div class="ch">Hotkeys</div>
          <div class="hint" style:margin-bottom="10px">Requires a modifier key (e.g. Ctrl+Alt+S). Leave blank to disable.</div>
          <div class="row"><label for="hkss">Start / Stop timer</label>
            <input id="hkss" class="ctl" bind:value={s.hotkeys.startStop} placeholder="e.g. Ctrl+Alt+S"></div>
          <div class="row"><label for="hkpr">Pause / Resume</label>
            <input id="hkpr" class="ctl" bind:value={s.hotkeys.pauseResume} placeholder="e.g. Ctrl+Alt+P"></div>
          <div class="row"><label for="hksk">Skip</label>
            <input id="hksk" class="ctl" bind:value={s.hotkeys.skip} placeholder="e.g. Ctrl+Alt+N"></div>
          <div class="row"><label for="hkset">Open settings</label>
            <input id="hkset" class="ctl" bind:value={s.hotkeys.settings} placeholder="e.g. Ctrl+Alt+,"></div>
        </div>
      </div>

    <!-- ===== TEXT ===== -->
    {:else if pane === 'text'}
      <div class="pane">
        <div class="panehead"><h2>Text</h2>{@render themeBtn()}</div>
        <div class="card">
          <div class="ch">Phase labels</div>
          <div class="row"><label for="tin">Inhale</label>
            <input id="tin" class="ctl" bind:value={s.text.phases.in}></div>
          <div class="row"><label for="tout">Exhale</label>
            <input id="tout" class="ctl" bind:value={s.text.phases.out}></div>
          <div class="row"><label for="thold">Hold</label>
            <input id="thold" class="ctl" bind:value={s.text.phases.hold}></div>
        </div>
      </div>

    <!-- ===== ABOUT ===== -->
    {:else if pane === 'about'}
      <div class="pane">
        <div class="panehead"><h2>About</h2>{@render themeBtn()}</div>
        <div class="card">
          <div class="about-center">
            <img src="/img/breathpause-128.png" alt="BreathPause" class="about-logo">
            <div class="about-name">BreathPause</div>
            <div class="about-ver">Version {version}</div>
            <div class="about-tag">An always-on-top breathing bubble for Windows. Sits in the corner and breathes quietly while you work, then guides you through a breathing break when the pomodoro timer runs out.</div>
            <div class="about-social">
              <button class="social-btn" title="GitHub" aria-label="GitHub"
                      onclick={() => openExternal('https://github.com/Markus-Wildgruber/breathpause')}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                  <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22 0 1.6-.01 2.9-.01 3.29 0 .32.22.7.83.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z"/>
                </svg>
              </button>
              <button class="social-btn" title="Instagram" aria-label="Instagram"
                      onclick={() => openExternal('https://www.instagram.com/breathe.nice/')}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <rect x="2" y="2" width="20" height="20" rx="5.5"/>
                  <circle cx="12" cy="12" r="4.2"/>
                  <circle cx="17.6" cy="6.4" r="1.2" fill="currentColor" stroke="none"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="ch">Info</div>
          <div class="row"><span class="rowlabel">Made by</span><span class="ctl static">Markus Wildgruber</span></div>
          <div class="row"><span class="rowlabel">License</span><span class="ctl static">MIT — © 2026 Markus Wildgruber</span></div>
        </div>
      </div>
    {/if}
  </div>

  <div class="foot">
    <button class="btn" onclick={onExit}>Quit</button>
    <button class="btn" onclick={onReset}>Reset</button>
    <span class="spacer"></span>
    <button class="btn" onclick={close}>Cancel</button>
    <button class="btn primary" onclick={onSave}>Save</button>
  </div>
</div>

<style>
  /* ===== theme tokens ===== */
  .win{--card:#1C1C1E;--pane:#161619;--bar:#2D2D3C;--rail:#121215;
       --fore:#F2F2F2;--muted:#9aa0aa;--accent:#4FC3F7;--accentFg:#06222c;
       --line:rgba(255,255,255,.10);--field:rgba(255,255,255,.07);
       --cardbg:rgba(255,255,255,.04);--railSel:var(--accent);--railSelFg:#06222c;
       --seg:rgba(255,255,255,.08);--segSel:rgba(255,255,255,.92);--segSelFg:#1a1a1f}
  .win[data-theme="light"]{--card:#f3f3f6;--pane:#fbfbfd;--bar:#e7e7ee;--rail:#ececf2;
       --fore:#1a1a1f;--muted:#5a5a63;--accent:#0a6cc9;--accentFg:#ffffff;
       --line:rgba(0,0,0,.10);--field:#ffffff;
       --cardbg:#ffffff;--railSel:#0a6cc9;--railSelFg:#ffffff;
       --seg:#e2e2ea;--segSel:#ffffff;--segSelFg:#1a1a1f}

  .win{height:100vh;display:flex;flex-direction:column;overflow:hidden;background:var(--card);
    color:var(--fore);font:13px/1.45 "Segoe UI",system-ui,sans-serif;transition:background .2s}

  .body{display:flex;flex:1;min-height:0}
  .rail{width:184px;flex:none;background:var(--rail);border-right:1px solid var(--line);padding:12px 10px}
  .navitem{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:9px;
    color:var(--muted);cursor:pointer;margin-bottom:2px;font-size:13.5px}
  .navitem:hover{background:var(--field)}
  .navitem.sel{background:var(--railSel);color:var(--railSelFg);font-weight:600}

  .pane{flex:1;background:var(--pane);overflow:auto;padding:18px 20px}
  .pane h2{margin:2px 0 0;font-size:18px;font-weight:600}
  .panehead{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:14px}

  .seg{display:inline-flex;background:var(--seg);border-radius:9px;padding:3px;gap:2px;flex:none}
  .seg button{border:0;background:transparent;color:var(--muted);font:inherit;font-size:15px;
    width:34px;height:30px;border-radius:7px;cursor:pointer;display:grid;place-items:center}
  .seg button.on{background:var(--segSel);color:var(--segSelFg);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.18)}

  .modeseg{display:flex;background:var(--seg);border-radius:9px;padding:3px;gap:2px;margin-bottom:14px}
  .modeseg button{flex:1;border:0;background:transparent;color:var(--muted);font:inherit;font-size:13.5px;
    height:34px;border-radius:7px;cursor:pointer;font-weight:600}
  .modeseg button.on{background:var(--segSel);color:var(--segSelFg);box-shadow:0 1px 3px rgba(0,0,0,.18)}

  .card{background:var(--cardbg);border:1px solid var(--line);border-radius:12px;
    padding:6px 16px 14px;margin:0 0 14px}
  .card.preview{padding:0;overflow:hidden;display:flex;align-items:stretch;
    height:200px;position:sticky;top:0;z-index:5;background:var(--card)}
  .ch{font-size:13px;font-weight:600;margin:14px 0 4px;opacity:.9}
  .row{display:grid;grid-template-columns:200px 1fr;align-items:center;gap:12px;margin:10px 0}
  .row label,.row .rowlabel{color:var(--muted);font-size:12.5px}
  .ctl{height:30px;border-radius:7px;background:var(--field);border:1px solid var(--line);
    color:var(--fore);padding:0 9px;display:inline-flex;align-items:center;gap:8px;font-size:13px;font:inherit}
  input.ctl{width:90px}
  input.ctl.small{width:96px}
  select.ctl{width:auto;min-width:160px}
  select.ctl option{background:var(--card);color:var(--fore)}
  .ctl.static{border-style:dashed;color:var(--muted)}

  .sliderwrap{display:flex;align-items:center;gap:12px;background:var(--field);
    border:1px solid var(--line);border-radius:7px;padding:9px 12px;max-width:330px}
  .sliderwrap input[type="range"]{flex:1;min-width:120px;accent-color:var(--accent);height:4px}
  .sval{color:var(--fore);font-size:12px;white-space:nowrap;text-align:right;min-width:48px}

  .chk{display:flex;align-items:center;gap:9px;margin:9px 0;color:var(--fore);cursor:pointer}
  .chk input{accent-color:var(--accent);width:16px;height:16px}
  .hint{color:var(--muted);font-size:12px;margin:4px 0 6px}
  .swatch{width:26px;height:26px;border-radius:7px;border:1px solid var(--muted);background:none;padding:0;cursor:pointer}
  .colorrow{display:flex;gap:9px;align-items:center}

  .orbside{flex:1;display:grid;place-items:center;padding:16px 10px;
    border-right:1px solid var(--line);
    background:radial-gradient(circle at 50% 38%,rgba(79,195,247,.10),transparent 70%)}
  .orb{display:grid;place-items:center}

  /* inline skin gallery in preview card */
  .psg{flex:1;display:flex;flex-wrap:wrap;gap:6px;align-content:flex-start;
    padding:10px 12px 10px 8px;overflow-y:auto}
  .psg-item{width:58px;cursor:pointer;border-radius:8px;border:2px solid transparent;
    padding:4px 4px 3px;text-align:center;transition:border-color .15s}
  .psg-item.selected{border-color:var(--accent)}
  .psg-item:hover:not(.selected){border-color:var(--muted)}
  .psg-preview{width:50px;height:50px;border-radius:50%;overflow:hidden;margin:0 auto 3px;
    background:radial-gradient(circle at 50% 44%,rgba(79,195,247,.09),transparent 70%)}
  .psg-name{font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  /* text tab preview */
  .text-sample{flex:1;display:flex;flex-direction:column;justify-content:center;
    padding:14px 8px 14px 16px;text-align:center;gap:3px;
    border-right:1px solid var(--line)}
  .ts-big{font-weight:600}
  .ts-small{font-size:12px;color:var(--muted)}
  .text-quick{flex:1;display:flex;flex-direction:column;justify-content:center;
    gap:8px;padding:10px 14px 10px 8px}
  .tq-row{display:flex;align-items:center;gap:8px}
  .tq-slider{max-width:none;flex:1}

  /* searchable font dropdown — matches the size-slider width */
  .fontdd{position:relative;width:100%}
  .fontdd-btn{width:100%;justify-content:space-between;cursor:pointer;text-align:left}
  .fontdd-cur{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fontdd-caret{color:var(--muted);font-size:11px;flex:none}
  .fontdd-backdrop{position:fixed;inset:0;z-index:40}
  .fontdd-panel{position:absolute;top:34px;left:0;right:0;z-index:41;
    background:var(--card);border:1px solid var(--line);border-radius:8px;
    box-shadow:0 10px 28px rgba(0,0,0,.35);padding:6px;display:flex;flex-direction:column;gap:6px}
  .fontdd-search{height:28px;border-radius:6px;background:var(--field);border:1px solid var(--line);
    color:var(--fore);padding:0 9px;font:inherit;font-size:12.5px;outline:none}
  .fontdd-search:focus{border-color:var(--accent)}
  .fontdd-list{max-height:176px;overflow-y:auto;display:flex;flex-direction:column}
  .fontdd-opt{padding:6px 9px;border-radius:6px;cursor:pointer;font-size:13px;color:var(--fore)}
  .fontdd-opt:hover{background:var(--field)}
  .fontdd-opt.sel{background:var(--accent);color:var(--accentFg)}
  .fontdd-empty{padding:6px 9px;color:var(--muted);font-size:12px}

  .apsubseg{display:flex;background:var(--seg);border-radius:9px;padding:3px;gap:2px;
    margin-bottom:14px;max-width:200px}
  .apsubseg button{flex:1;border:0;background:transparent;color:var(--muted);font:inherit;
    font-size:13px;height:30px;border-radius:7px;cursor:pointer;font-weight:500}
  .apsubseg button.on{background:var(--segSel);color:var(--segSelFg);
    box-shadow:0 1px 3px rgba(0,0,0,.18)}

  /* pattern gallery */
  .gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:14px}
  .gitem{background:var(--cardbg);border:1px solid var(--line);border-radius:10px;
    padding:12px 14px;cursor:pointer;transition:border-color .15s}
  .gitem:hover{border-color:var(--accent)}
  .gadd{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:70px}
  .gplus{font-size:22px;color:var(--accent);line-height:1}
  .gname{font-weight:600;font-size:13px;margin-bottom:4px}
  .gsummary{color:var(--muted);font-size:11.5px;line-height:1.4}
  .editor-foot{display:flex;align-items:center;gap:8px;margin-top:14px;padding-top:12px;
    border-top:1px solid var(--line)}

  /* skin gallery */
  .skin-gallery{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
  .skin-gitem{padding:0 0 12px;display:flex;flex-direction:column;cursor:default}
  .skin-preview{width:100%;height:110px;display:grid;place-items:center;overflow:hidden;
    border-radius:8px 8px 0 0;
    background:radial-gradient(circle at 50% 44%,rgba(79,195,247,.09),transparent 70%)}
  .skin-modes{display:flex;gap:6px;padding:8px 14px 0;flex-wrap:wrap}
  .skin-btn{border:1px solid var(--line);background:var(--field);color:var(--muted);
    padding:4px 12px;border-radius:6px;cursor:pointer;font:inherit;font-size:12px}
  .skin-btn.on{background:var(--accent);color:var(--accentFg);border-color:transparent;font-weight:600}
  .skin-gitem .gname{padding:8px 14px 0;margin-bottom:0}
  .skin-del-btn{border:0;background:transparent;color:var(--muted);cursor:pointer;font:inherit;
    font-size:11px;padding:4px 14px 0;text-align:left}
  .skin-del-btn:hover{color:#e05252}
  .skin-gadd{padding:12px 14px}

  /* about */
  .about-center{text-align:center;padding:18px 0 10px}
  .about-logo{width:64px;height:64px;border-radius:14px;margin-bottom:8px}
  .about-name{font-size:20px;font-weight:700;margin-bottom:4px}
  .about-ver{color:var(--muted);font-size:12px;margin-bottom:10px}
  .about-tag{color:var(--muted);font-size:12.5px;max-width:360px;margin:0 auto 6px;line-height:1.5}
  .about-social{display:flex;justify-content:center;gap:10px;margin-top:12px}
  .social-btn{display:grid;place-items:center;width:38px;height:38px;border-radius:9px;
    border:1px solid var(--line);background:var(--field);color:var(--muted);cursor:pointer}
  .social-btn:hover{color:var(--accent);border-color:var(--accent)}

  .foot{flex:none;display:flex;align-items:center;gap:10px;padding:14px 18px;border-top:1px solid var(--line);background:var(--card)}
  .btn{padding:8px 16px;border-radius:8px;border:1px solid var(--line);background:var(--field);color:var(--fore);cursor:pointer;font:inherit}
  .btn.primary{background:var(--accent);color:var(--accentFg);border:0;font-weight:600}
  .spacer{flex:1}
</style>
