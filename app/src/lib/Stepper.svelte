<script>
  // Reusable number/duration field: a text input + ▲▼ steppers, one consistent design.
  // `value` is the raw bound value (a number — e.g. seconds for durations). `format`/`parse`
  // convert to/from the displayed text, so the same control serves plain integers and mm:ss.
  let {
    value = $bindable(),
    min = -Infinity, max = Infinity, step = 1,
    format = (v) => String(v ?? ''),
    parse = (t) => { const n = parseInt(t, 10); return Number.isFinite(n) ? n : null; },
    width = 74,
  } = $props();

  const clamp = (v) => Math.min(max, Math.max(min, v));
  let text = $state(format(value));
  // Reflect external value changes (steppers, resets) into the field.
  $effect(() => { text = format(value); });

  function commit() {
    const v = parse(text);
    value = clamp(v == null ? (value ?? min) : v);
    text = format(value);            // snap display to the canonical form
  }
  function bump(d) { value = clamp((value ?? 0) + d * step); }
</script>

<div class="stepper">
  <input class="sf-input" type="text" inputmode="numeric" bind:value={text}
         style:width="{width}px"
         onblur={commit} onkeydown={(e) => e.key === 'Enter' && commit()}>
  <div class="sf-btns">
    <button type="button" onclick={() => bump(1)} aria-label="Increase">▲</button>
    <button type="button" onclick={() => bump(-1)} aria-label="Decrease">▼</button>
  </div>
</div>

<style>
  .stepper{display:inline-flex;align-items:stretch}
  .sf-input{height:30px;border:1px solid var(--line);border-radius:7px 0 0 7px;background:var(--field);
    color:var(--fore);padding:0 9px;font:inherit;font-size:13px;text-align:center;outline:none;box-sizing:border-box}
  .sf-input:focus{border-color:var(--accent)}
  .sf-btns{display:flex;flex-direction:column;border:1px solid var(--line);border-left:0;
    border-radius:0 7px 7px 0;overflow:hidden}
  .sf-btns button{flex:1;border:0;background:var(--field);color:var(--muted);cursor:pointer;
    font-size:8px;line-height:1;padding:0 7px;display:grid;place-items:center}
  .sf-btns button:hover{background:var(--seg);color:var(--fore)}
</style>
