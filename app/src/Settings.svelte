<script>
  // Settings window — implements settings-mockups.html (repo root): rail navigation,
  // light/dark theme tokens (defaults to OS theme, themes this window only), card
  // layout, live orb preview, Save/Cancel/Reset/Exit footer.
  import { onMount } from 'svelte';
  import Timefmt from './core/timefmt.js';
  import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './lib/settings-store.js';

  const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  let s = $state(loadSettings());
  let theme = $state(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  let pane = $state('appearance');

  const NAV = [
    { id: 'timers', label: 'Timers' },
    { id: 'patterns', label: 'Patterns' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'behavior', label: 'Behavior' },
    { id: 'text', label: 'Text' },
    { id: 'about', label: 'About' },
  ];

  // duration fields edited as text (mm:ss / hh:mm), parsed via the core timefmt module
  let workTxt = $state(fmt(loadSettings().timers.workSeconds));
  let breakTxt = $state(fmt(loadSettings().timers.breakSeconds));
  let longTxt = $state(fmt(loadSettings().timers.longBreakSeconds));
  function fmt(sec) { return Timefmt.formatRemaining(sec); }

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
    saveSettings($state.snapshot(s));
    await emitChanged();
    await close();
  }
  function onReset() {
    s = structuredClone(DEFAULT_SETTINGS);
    workTxt = fmt(s.timers.workSeconds);
    breakTxt = fmt(s.timers.breakSeconds);
    longTxt = fmt(s.timers.longBreakSeconds);
  }
  async function onExit() {
    if (!inTauri) return;
    const { emit } = await import('@tauri-apps/api/event');
    await emit('app-quit');
  }

  onMount(() => { document.body.classList.add('settings-body'); });
</script>

<div class="win" data-theme={theme}>
  <div class="titlebar" data-tauri-drag-region>
    <div class="dot"></div><div class="ttl">breathpause</div>
    <button class="capbtn x" onclick={close}>✕</button>
  </div>

  <div class="body">
    <div class="rail">
      {#each NAV as n}
        <div class="navitem" class:sel={pane === n.id} role="button" tabindex="0"
             onclick={() => pane = n.id} onkeydown={(e) => e.key === 'Enter' && (pane = n.id)}>
          {n.label}
        </div>
      {/each}
    </div>

    {#if pane === 'appearance'}
      <div class="pane">
        <div class="panehead">
          <div>
            <h2>Appearance</h2>
            <div class="sub">How the orb looks and what it shows.</div>
          </div>
          <div class="seg">
            <button class:on={theme === 'light'} title="Light" onclick={() => theme = 'light'}>☀</button>
            <button class:on={theme === 'dark'} title="Dark" onclick={() => theme = 'dark'}>☾</button>
          </div>
        </div>

        <div class="card preview">
          <div class="orbside">
            <div class="orb" style:opacity={s.appearance.opacity}>
              {#if s.appearance.showPhaseLabel}<div class="olabel" style:color={s.appearance.textColor}>Breathe in</div>{/if}
              {#if s.appearance.showPhaseCountdown}<div class="ocount" style:color={s.appearance.textColor}>0:04</div>{/if}
            </div>
          </div>
          <div class="orbtxt">
            <div class="big">Live preview</div>
            <div class="small">Reflects your colors, opacity, font &amp; labels</div>
            {#if s.appearance.showPomodoro}<div class="small">04:32 pomodoro shown under the orb</div>{/if}
          </div>
        </div>

        <div class="card">
          <div class="ch">Bubble</div>
          <div class="row"><label for="op">Opacity</label>
            <div class="sliderwrap"><input id="op" type="range" min="20" max="100" bind:value={
              () => Math.round(s.appearance.opacity * 100), (v) => s.appearance.opacity = v / 100
            }><span class="sval">{Math.round(s.appearance.opacity * 100)}%</span></div></div>
          <div class="row"><label for="szc">Size collapsed</label>
            <div class="sliderwrap"><input id="szc" type="range" min="40" max="200" bind:value={s.appearance.collapsedPx}><span class="sval">{s.appearance.collapsedPx}px</span></div></div>
          <div class="row"><label for="sze">Size expanded</label>
            <div class="sliderwrap"><input id="sze" type="range" min="100" max="400" bind:value={s.appearance.expandedPx}><span class="sval">{s.appearance.expandedPx}px</span></div></div>
          <div class="row"><label for="szb">Break size (screen)</label>
            <div class="sliderwrap"><input id="szb" type="range" min="20" max="90" bind:value={s.appearance.breakPct}><span class="sval">{s.appearance.breakPct}%</span></div></div>
        </div>

        <div class="card">
          <div class="ch">Text &amp; font</div>
          <div class="row"><label for="font">Font family</label>
            <select id="font" class="ctl" bind:value={s.appearance.font}>
              <option>Segoe UI Variable</option><option>Segoe UI</option><option>Calibri</option>
            </select></div>
          <div class="row"><label for="ls">Phase label size</label>
            <div class="sliderwrap"><input id="ls" type="range" min="10" max="32" bind:value={s.appearance.labelSize}><span class="sval">{s.appearance.labelSize}</span></div></div>
          <label class="chk"><input type="checkbox" bind:checked={s.appearance.showPhaseLabel}>Show phase label</label>
          <label class="chk"><input type="checkbox" bind:checked={s.appearance.showPhaseCountdown}>Show phase countdown</label>
          <label class="chk"><input type="checkbox" bind:checked={s.appearance.showPomodoro}>Show pomodoro time</label>
          <label class="chk"><input type="checkbox" bind:checked={s.appearance.showSessions}>Show sessions until long break</label>
        </div>

        <div class="card">
          <div class="ch">Colors</div>
          <div class="row"><label for="wf">Work fill</label>
            <div class="colorrow"><input type="color" class="swatch" bind:value={s.appearance.workFill}><input id="wf" class="ctl small" bind:value={s.appearance.workFill}></div></div>
          <div class="row"><label for="bf">Break fill</label>
            <div class="colorrow"><input type="color" class="swatch" bind:value={s.appearance.breakFill}><input id="bf" class="ctl small" bind:value={s.appearance.breakFill}></div></div>
          <div class="row"><label for="tc">Text</label>
            <div class="colorrow"><input type="color" class="swatch" bind:value={s.appearance.textColor}><input id="tc" class="ctl small" bind:value={s.appearance.textColor}></div></div>
        </div>
      </div>
    {:else if pane === 'timers'}
      <div class="pane">
        <h2>Timers</h2>
        <div class="sub">Work / break durations and the long-break cycle.</div>
        <div class="card">
          <div class="ch">Durations</div>
          <div class="row"><label for="wt">Work (hh:mm)</label><input id="wt" class="ctl" bind:value={workTxt}></div>
          <div class="row"><label for="bt">Break (mm:ss)</label><input id="bt" class="ctl" bind:value={breakTxt}></div>
          <div class="row"><label for="lt">Long break (mm:ss)</label><input id="lt" class="ctl" bind:value={longTxt}></div>
        </div>
        <div class="card">
          <div class="ch">Cycle</div>
          <div class="row"><label for="lbe">Long break every N (0 = off)</label>
            <input id="lbe" class="ctl" type="number" min="0" max="12" bind:value={s.timers.longBreakEvery}></div>
          <label class="chk"><input type="checkbox" bind:checked={s.timers.autoContinue}>Auto-continue to next segment</label>
        </div>
      </div>
    {:else if pane === 'patterns'}
      <div class="pane">
        <h2>Patterns</h2>
        <div class="sub">Breathing patterns per mode — editor coming next.</div>
        <div class="card">
          <div class="ch">Current</div>
          <div class="row"><label>Work</label><span class="ctl static">5.5 in / 5.5 out (coherent)</span></div>
          <div class="row"><label>Break</label><span class="ctl static">4 in / 4 hold / 6 out</span></div>
        </div>
      </div>
    {:else}
      <div class="pane">
        <h2>{NAV.find(n => n.id === pane)?.label}</h2>
        <div class="sub">Same rail + card layout applies to every section.</div>
        <div class="card"><div class="ch">Settings</div>
          <div class="row"><label>Coming soon</label><span class="ctl static">…</span></div></div>
      </div>
    {/if}
  </div>

  <div class="foot">
    <button class="btn" onclick={onExit}>Exit</button>
    <button class="btn" onclick={onReset}>Reset</button>
    <span class="spacer"></span>
    <button class="btn" onclick={close}>Cancel</button>
    <button class="btn primary" onclick={onSave}>Save</button>
  </div>
</div>

<style>
  /* ===== theme tokens — from settings-mockups.html ===== */
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

  .titlebar{height:44px;flex:none;display:flex;align-items:center;gap:10px;padding:0 4px 0 16px;background:var(--bar)}
  .dot{width:18px;height:18px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#7fd9ff,#2d8fd6)}
  .ttl{font-weight:600;flex:1}
  .capbtn{width:42px;height:44px;display:grid;place-items:center;color:var(--muted);
    border:0;background:transparent;font:inherit;cursor:pointer}
  .capbtn.x:hover{background:#E81123;color:#fff}

  .body{display:flex;flex:1;min-height:0}
  .rail{width:184px;flex:none;background:var(--rail);border-right:1px solid var(--line);padding:12px 10px}
  .navitem{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:9px;
    color:var(--muted);cursor:pointer;margin-bottom:2px;font-size:13.5px}
  .navitem:hover{background:var(--field)}
  .navitem.sel{background:var(--railSel);color:var(--railSelFg);font-weight:600}

  .pane{flex:1;background:var(--pane);overflow:auto;padding:18px 20px}
  .pane h2{margin:2px 0 4px;font-size:18px;font-weight:600}
  .pane .sub{color:var(--muted);font-size:12.5px;margin-bottom:14px}
  .panehead{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}

  .seg{display:inline-flex;background:var(--seg);border-radius:9px;padding:3px;gap:2px;flex:none}
  .seg button{border:0;background:transparent;color:var(--muted);font:inherit;font-size:15px;
    width:34px;height:30px;border-radius:7px;cursor:pointer;display:grid;place-items:center}
  .seg button.on{background:var(--segSel);color:var(--segSelFg);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.18)}

  .card{background:var(--cardbg);border:1px solid var(--line);border-radius:12px;
    padding:6px 16px 14px;margin:0 0 14px}
  .card.preview{padding:0;overflow:hidden;display:flex;align-items:center;gap:18px;
    position:sticky;top:0;z-index:5;background:var(--card)}
  .ch{font-size:13px;font-weight:600;margin:14px 0 4px;opacity:.9}
  .row{display:grid;grid-template-columns:200px 1fr;align-items:center;gap:12px;margin:10px 0}
  .row label{color:var(--muted);font-size:12.5px}
  .ctl{height:30px;border-radius:7px;background:var(--field);border:1px solid var(--line);
    color:var(--fore);padding:0 9px;display:inline-flex;align-items:center;gap:8px;font-size:13px;font:inherit}
  input.ctl{width:90px}
  input.ctl.small{width:96px}
  select.ctl{width:auto;min-width:160px}
  .ctl.static{border-style:dashed;color:var(--muted)}

  .sliderwrap{display:flex;align-items:center;gap:12px;background:var(--field);
    border:1px solid var(--line);border-radius:7px;padding:9px 12px;max-width:330px}
  .sliderwrap input[type="range"]{flex:1;min-width:120px;accent-color:var(--accent);height:4px}
  .sval{color:var(--fore);font-size:12px;white-space:nowrap;text-align:right;min-width:48px}

  .chk{display:flex;align-items:center;gap:9px;margin:9px 0;color:var(--fore);cursor:pointer}
  .chk input{accent-color:var(--accent);width:16px;height:16px}
  .swatch{width:26px;height:26px;border-radius:7px;border:1px solid var(--muted);background:none;padding:0;cursor:pointer}
  .colorrow{display:flex;gap:9px;align-items:center}

  .orbside{width:210px;align-self:stretch;display:grid;place-items:center;min-height:150px;
    background:radial-gradient(circle at 50% 38%,rgba(79,195,247,.10),transparent 70%)}
  .orb{width:120px;height:120px;border-radius:50%;
    background:radial-gradient(circle at 38% 32%,#7fd9ff,#2d8fd6);
    box-shadow:0 0 38px rgba(79,195,247,.45);animation:breathe 6s ease-in-out infinite;
    display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
  .orb .olabel{font-size:13px;font-weight:600;text-shadow:0 1px 4px rgba(0,0,0,.45)}
  .orb .ocount{font-size:12px;opacity:.92;text-shadow:0 1px 4px rgba(0,0,0,.45)}
  @keyframes breathe{0%,100%{transform:scale(.82)}50%{transform:scale(1.08)}}
  .orbtxt{padding:18px 18px 18px 4px}
  .orbtxt .big{font-size:15px;font-weight:600}
  .orbtxt .small{color:var(--muted);font-size:12px;margin-top:3px}

  .foot{flex:none;display:flex;align-items:center;gap:10px;padding:14px 18px;border-top:1px solid var(--line);background:var(--card)}
  .btn{padding:8px 16px;border-radius:8px;border:1px solid var(--line);background:var(--field);color:var(--fore);cursor:pointer;font:inherit}
  .btn.primary{background:var(--accent);color:var(--accentFg);border:0;font-weight:600}
  .spacer{flex:1}
</style>
