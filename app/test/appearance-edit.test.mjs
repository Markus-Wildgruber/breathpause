import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setSkinColor, setLineColor, SIZE_RANGE, LINE_PARTS } from '../src/lib/appearance-edit.js';
import { DEFAULT_SETTINGS } from '../src/lib/settings-store.js';

test('setSkinColor sets a per-skin color and "" removes it again', () => {
  const s = { skinColors: {} };
  setSkinColor(s, 'orb', '#FF0000');
  assert.deepEqual(s.skinColors, { orb: '#FF0000' });
  setSkinColor(s, 'orb', '');
  assert.equal('orb' in s.skinColors, false);
});

test('setLineColor writes the per-line key the bubble renders from', () => {
  const ap = structuredClone(DEFAULT_SETTINGS.appearance.work);
  setLineColor(ap, 'label', '#00AA00');
  setLineColor(ap, 'sub', '#0000AA');
  assert.equal(ap.labelColor, '#00AA00');
  assert.equal(ap.subColor, '#0000AA');
  setLineColor(ap, 'sub', '');
  assert.equal(ap.subColor, '');
});

test('every shared key exists in the default appearance', () => {
  const ap = DEFAULT_SETTINGS.appearance.work;
  for (const line of Object.keys(SIZE_RANGE)) {
    for (const k of [line + 'Size', line + 'Color', line + 'OffsetX', line + 'OffsetY']) assert.ok(k in ap, k);
    for (const [k] of LINE_PARTS[line]) assert.ok(k in ap, k);
  }
});
