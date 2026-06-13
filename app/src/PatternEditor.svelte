<script>
  import { onMount } from 'svelte';
  import Stepper from './lib/Stepper.svelte';
  import { loadSettings, saveSettings, applyPatternResult } from './lib/settings-store.js';

  const DRAFT_KEY = 'breathpause.patternDraft';
  const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  // Follow the saved app theme (shared origin -> same localStorage); fall back to OS.
  const osTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const theme = loadSettings().theme || osTheme;

  let pattern = $state({ id: '', name: '', phases: [] });
  let isNew = $state(true);
  let error = $state('');
  let existingNames = $state([]);   // other patterns' names, to flag duplicates

  // Live duplicate-name check (case-insensitive), used to mark the field and block save.
  let nameExists = $derived(
    pattern.name.trim() !== '' &&
    existingNames.some((n) => n.trim().toLowerCase() === pattern.name.trim().toLowerCase()),
  );

  // Float seconds for the phase steppers (e.g. 5.5).
  const parseSeconds = (t) => { const n = parseFloat(t); return Number.isFinite(n) ? n : null; };

  onMount(async () => {
    try {
      const raw = JSON.parse(localStorage.getItem(DRAFT_KEY));
      if (raw) {
        pattern = structuredClone(raw.pattern);
        isNew = raw.isNew ?? true;
        existingNames = raw.existingNames ?? [];
      }
    } catch {}

    if (inTauri) {
      const { restoreWindowPosition, trackWindowPosition } = await import('./lib/window-state.js');
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      await restoreWindowPosition('pattern-editor', win);
      await win.show();        // built hidden in Rust; reveal after positioning (no flash)
      await win.setFocus();
      return await trackWindowPosition('pattern-editor', win);
    }
  });

  function addPhase() {
    pattern.phases.push({ type: 'in', seconds: 4 });
  }

  function removePhase(i) {
    pattern.phases.splice(i, 1);
  }

  // Persist the result straight into shared settings (this window owns the save), then tell
  // the settings window to refresh its gallery and the bubble to reload. No cross-window
  // hand-off required for the data to survive.
  function persistResult(result) {
    const fresh = loadSettings();
    const next = applyPatternResult(fresh.patterns, fresh.timers, result);
    saveSettings({ ...fresh, patterns: next.patterns, timers: next.timers });
  }

  async function closeWithRefresh() {
    if (!inTauri) return;
    const { emit } = await import('@tauri-apps/api/event');
    await emit('pattern-editor-saved');   // settings window re-reads patterns
    await emit('settings-changed');       // bubble reloads
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  }

  async function onSave() {
    error = '';
    if (!pattern.name.trim()) { error = 'Name is required.'; return; }
    if (nameExists) { error = 'A pattern with this name already exists.'; return; }
    if (pattern.phases.length === 0) { error = 'Add at least one phase.'; return; }
    persistResult($state.snapshot(pattern));
    await closeWithRefresh();
  }

  async function onDelete() {
    persistResult({ id: pattern.id, deleted: true });
    await closeWithRefresh();
  }

  async function onCancel() {
    if (!inTauri) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  }

  let total = $derived(pattern.phases.reduce((s, p) => s + (Number(p.seconds) || 0), 0));
</script>

<div class="win" data-theme={theme}>
  <div class="pane">
    <div class="panehead">
      <!-- svelte-ignore a11y_autofocus -->
      <input class="title-input" class:invalid={nameExists} bind:value={pattern.name}
             placeholder="pattern name" aria-label="Pattern name">
    </div>
    {#if nameExists}<div class="err">A pattern with this name already exists.</div>{/if}

    <div class="card">
      {#each pattern.phases as phase, i}
        <div class="phase-row">
          <select class="ctl phase-type" bind:value={phase.type}>
            <option value="in">Inhale</option>
            <option value="out">Exhale</option>
            <option value="hold">Hold</option>
          </select>
          <Stepper bind:value={phase.seconds} min={0.1} max={120} step={0.5}
                   format={(v) => String(v)} parse={parseSeconds} width={64} />
          <span class="phase-unit">s</span>
          <button class="phase-del" onclick={() => removePhase(i)} title="Remove">×</button>
        </div>
      {/each}
      <button class="btn-link" onclick={addPhase}>+ Add phase</button>
    </div>

    {#if pattern.phases.length > 0 && total > 0}
      <div class="card">
        <div class="ch">Preview</div>
        <div class="timeline">
          {#each pattern.phases as ph}
            <div class="tphase tphase-{ph.type}" style:flex="{Number(ph.seconds) || 1}" title="{ph.type} {ph.seconds}s">
              <span class="tphase-label">{ph.seconds}s</span>
            </div>
          {/each}
        </div>
        <div class="timeline-labels">
          {#each pattern.phases as ph}
            <div class="tlabel" style:flex="{Number(ph.seconds) || 1}">
              {ph.type === 'in' ? 'inhale' : ph.type === 'out' ? 'exhale' : 'hold'}
            </div>
          {/each}
        </div>
        <div class="total-time">Cycle: {total.toFixed(1)}s = {(60 / total).toFixed(1)} breaths/min</div>
      </div>
    {/if}

    {#if error}<div class="err">{error}</div>{/if}
  </div>

  <div class="foot">
    {#if !isNew}
      <button class="btn danger" onclick={onDelete}>Delete</button>
    {/if}
    <span class="spacer"></span>
    <button class="btn" onclick={onCancel}>Cancel</button>
    <button class="btn primary" disabled={pattern.phases.length === 0 || !pattern.name.trim()}
            onclick={onSave}>Save</button>
  </div>
</div>

<style>
  :global(body){margin:0;overflow:hidden}

  .win{--card:#1C1C1E;--pane:#161619;
       --fore:#F2F2F2;--muted:#9aa0aa;--accent:#4FC3F7;--accentFg:#06222c;
       --line:rgba(255,255,255,.10);--field:rgba(255,255,255,.07);--cardbg:rgba(255,255,255,.04)}
  .win[data-theme="light"]{--card:#f3f3f6;--pane:#fbfbfd;
       --fore:#1a1a1f;--muted:#5a5a63;--accent:#0a6cc9;--accentFg:#ffffff;
       --line:rgba(0,0,0,.10);--field:#ffffff;--cardbg:#ffffff}

  .win{height:100vh;display:flex;flex-direction:column;overflow:hidden;
       background:var(--card);color:var(--fore);font:13px/1.45 "Segoe UI",system-ui,sans-serif}
  .pane{flex:1;overflow:auto;padding:18px 20px;background:var(--pane)}
  .pane h2{margin:2px 0 0;font-size:18px;font-weight:600}
  .panehead{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:14px}

  .card{background:var(--cardbg);border:1px solid var(--line);border-radius:12px;
    padding:6px 16px 14px;margin:0 0 14px}
  .ch{font-size:13px;font-weight:600;margin:14px 0 4px;opacity:.9}
  .row{display:grid;grid-template-columns:70px 1fr;align-items:center;gap:12px;margin:10px 0}
  .row label{color:var(--muted);font-size:12.5px}
  .ctl{height:30px;border-radius:7px;background:var(--field);border:1px solid var(--line);
    color:var(--fore);padding:0 9px;font:inherit;font-size:13px}
  select.ctl option{background:var(--card);color:var(--fore)}
  /* name doubles as the title */
  .title-input{width:100%;background:transparent;border:1px solid transparent;border-radius:8px;
    color:var(--fore);font:inherit;font-size:18px;font-weight:600;padding:6px 8px;outline:none}
  .title-input:hover{border-color:var(--line)}
  .title-input:focus{border-color:var(--accent);background:var(--field)}
  .title-input.invalid{border-color:#e05252}

  .phase-row{display:flex;align-items:center;gap:8px;margin:7px 0}
  .phase-type{min-width:100px;width:100px}
  .phase-sec{width:72px;min-width:72px}
  .phase-unit{color:var(--muted);font-size:12px}
  .phase-del{border:0;background:transparent;color:var(--muted);cursor:pointer;font-size:16px;
    padding:0 5px;line-height:1;border-radius:4px}
  .phase-del:hover{color:var(--fore);background:var(--field)}
  .btn-link{border:0;background:transparent;color:var(--accent);cursor:pointer;font:inherit;
    font-size:12.5px;padding:6px 0;margin-top:2px}

  .timeline{display:flex;height:34px;border-radius:8px;overflow:hidden;margin:8px 0 0}
  .tphase{display:flex;align-items:center;justify-content:center;min-width:0;overflow:hidden}
  .tphase-in{background:#4FC3F7;color:#06222c}
  .tphase-out{background:#81C784;color:#1a3a1f}
  .tphase-hold{background:#FFD54F;color:#3a2f00}
  .tphase-label{font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;
    text-overflow:ellipsis;padding:0 4px}
  .timeline-labels{display:flex;margin:3px 0 6px}
  .tlabel{flex:1;font-size:10.5px;color:var(--muted);text-align:center;
    overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .total-time{color:var(--muted);font-size:11.5px;text-align:right}

  .err{color:#e05252;font-size:12px;margin:4px 0 12px}

  .foot{flex:none;display:flex;align-items:center;gap:10px;padding:14px 18px;
    border-top:1px solid var(--line);background:var(--card)}
  .btn{padding:8px 16px;border-radius:8px;border:1px solid var(--line);background:var(--field);
    color:var(--fore);cursor:pointer;font:inherit}
  .btn.primary{background:var(--accent);color:var(--accentFg);border:0;font-weight:600}
  .btn.primary:disabled{opacity:.45;cursor:default}
  .btn.danger{background:transparent;border-color:#e05252;color:#e05252}
  .btn.danger:hover{background:#e05252;color:#fff}
  .spacer{flex:1}
</style>
