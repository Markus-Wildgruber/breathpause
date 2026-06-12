// IPC contract — pins the JS<->Rust seam that no unit test can otherwise reach.
// Reads the real Rust source, the capability manifest, and the JS sources, and asserts
// the event names, tray-text payload shape, and window labels still line up across the
// language boundary. A rename or dropped key on either side fails here instead of
// silently breaking at runtime (where the Rust side just `return`s on a bad payload).

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { DEFAULT_SETTINGS } from '../src/lib/settings-store.js';

const root = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');

const libRs = read('src-tauri/src/lib.rs');
const capability = JSON.parse(read('src-tauri/capabilities/default.json'));

// Concatenate every JS/Svelte source so we can assert an event is used somewhere on the JS side.
const jsSources = readdirSync(new URL('src/', root), { recursive: true })
  .filter((f) => typeof f === 'string' && (f.endsWith('.js') || f.endsWith('.svelte')))
  .map((f) => read(`src/${f}`))
  .join('\n');

// Events the JS side emits for the Rust side to handle.
const JS_TO_RUST = ['app-quit', 'apply-tray-text', 'open-settings', 'open-pattern-editor'];
// Events the Rust side emits for the JS side to handle.
const RUST_TO_JS = ['toggle-pause'];

test('JS->Rust events are emitted in JS and listened for in Rust', () => {
  for (const ev of JS_TO_RUST) {
    assert.ok(jsSources.includes(`emit('${ev}'`), `JS should emit '${ev}'`);
    assert.ok(libRs.includes(`listen_any("${ev}"`), `Rust should listen_any for "${ev}"`);
  }
});

test('Rust->JS events are emitted in Rust and listened for in JS', () => {
  for (const ev of RUST_TO_JS) {
    assert.ok(libRs.includes(`"${ev}"`), `Rust should emit "${ev}"`);
    assert.ok(jsSources.includes(`listen('${ev}'`), `JS should listen for '${ev}'`);
  }
});

test('tray-text payload: every field Rust deserializes is provided by settings', () => {
  // Pull the field names out of `struct TrayTextPayload { ... }`.
  const block = libRs.match(/struct\s+TrayTextPayload\s*\{([^}]*)\}/);
  assert.ok(block, 'TrayTextPayload struct not found in lib.rs');
  const fields = [...block[1].matchAll(/(\w+)\s*:\s*String/g)].map((m) => m[1]);
  assert.ok(fields.length > 0, 'no String fields parsed from TrayTextPayload');

  // settings.text.tray is what gets emitted as the payload — it must cover every field,
  // or serde's deserialize fails and the tray silently keeps its old labels.
  const trayKeys = Object.keys(DEFAULT_SETTINGS.text.tray);
  for (const f of fields) {
    assert.ok(trayKeys.includes(f), `settings.text.tray is missing tray-payload field "${f}"`);
  }
});

test('every window label created/emitted-to is allowed in the capability manifest', () => {
  const allowed = new Set(capability.windows);
  // Labels the app actually uses: the bubble (config), plus the two JS-built windows.
  for (const label of ['bubble', 'settings', 'pattern-editor']) {
    assert.ok(allowed.has(label), `capability windows should include "${label}"`);
  }
});
