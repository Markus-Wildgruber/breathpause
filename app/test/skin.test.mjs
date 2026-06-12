import { test } from 'node:test';
import assert from 'node:assert';
import { validateBinding, applyPalette, recolor, scanColors, isNeutral } from '../src/lib/skin.js';

const ok = { target: 'orb', property: 'scale', source: 'breath', from: 0, to: 1 };

test('validateBinding accepts a well-formed binding', () => {
  assert.doesNotThrow(() => validateBinding(ok));
});

test('validateBinding rejects a missing target', () => {
  assert.throws(() => validateBinding({ ...ok, target: undefined }), /missing "target"/);
});

test('validateBinding rejects an unknown property', () => {
  assert.throws(() => validateBinding({ ...ok, property: 'wobble' }), /unknown property/);
});

test('validateBinding rejects an unknown source', () => {
  assert.throws(() => validateBinding({ ...ok, source: 'mouse' }), /unknown source/);
});

test('validateBinding rejects non-numeric from/to', () => {
  assert.throws(() => validateBinding({ ...ok, from: '0' }), /must be numbers/);
  assert.throws(() => validateBinding({ ...ok, to: null }), /must be numbers/);
});

test('applyPalette replaces a hex color case-insensitively', () => {
  const out = applyPalette('<path fill="#D3D7CF"/>', { '#d3d7cf': '#ffffff' });
  assert.equal(out, '<path fill="#ffffff"/>');
});

test('applyPalette treats keys literally (regex metachars are escaped)', () => {
  // Without escaping, "a.b" as a regex would also match "a+b".
  const out = applyPalette('a.b a+b', { 'a.b': 'X' });
  assert.equal(out, 'X a+b');
});

test('applyPalette applies multiple entries and leaves an empty palette untouched', () => {
  assert.equal(applyPalette('<a/><b/>', { '<a/>': '1', '<b/>': '2' }), '12');
  assert.equal(applyPalette('<svg/>', {}), '<svg/>');
});

test('recolor is a no-op when fill equals the anchor (authored look)', () => {
  const svg = '<circle fill="#4a90c8"/>';
  assert.equal(recolor(svg, '#4a90c8', '#4a90c8'), svg);
});

test('recolor rotates a saturated color toward the fill hue', () => {
  // blue anchor -> red fill: a blue fill should land on (about) a red.
  const out = recolor('<circle fill="#4a90c8"/>', '#4a90c8', '#c84a4a');
  const hex = out.match(/#[0-9a-f]{6}/)[0];
  const [r, , b] = [hex.slice(1,3), hex.slice(3,5), hex.slice(5,7)].map(h => parseInt(h, 16));
  assert.ok(r > b, `expected a reddish result, got ${hex}`);
});

test('recolor leaves near-neutral colors untouched (white highlight survives)', () => {
  const out = recolor('<stop stop-color="#ffffff"/><circle fill="#4a90c8"/>', '#4a90c8', '#c84a4a');
  assert.ok(out.includes('#ffffff'), 'white should not shift');
});

test('recolor with tintNeutrals tints a mid-grey body toward the fill hue', () => {
  // grey body + blue anchor, fill red, tintNeutrals on -> grey takes a reddish tint.
  const out = recolor('<body fill="#808080"/>', '#4a90c8', '#c84a4a', true);
  const hex = out.match(/#[0-9a-f]{6}/)[0];
  assert.notEqual(hex, '#808080', 'grey should be tinted');
  const [r, , b] = [hex.slice(1,3), hex.slice(3,5), hex.slice(5,7)].map(h => parseInt(h, 16));
  assert.ok(r > b, `tinted grey should lean toward the red fill, got ${hex}`);
});

test('recolor with tintNeutrals shifts neutral lightness toward the color', () => {
  const lum = s => parseInt(s.match(/#([0-9a-f]{2})/i)[1], 16);
  // mid-grey body, grey anchor: a near-black color darkens it, a near-white color lightens it.
  const dark  = recolor('<b fill="#808080"/>', '#888888', '#222222', true);
  const light = recolor('<b fill="#808080"/>', '#888888', '#dddddd', true);
  assert.ok(lum(dark) < 128, `dark color should darken the body, got ${dark}`);
  assert.ok(lum(light) > 128, `light color should lighten the body, got ${light}`);
});

test('recolor preserves a color\'s lightness (shading survives)', () => {
  // A dark stop stays dark, a light stop stays light, only hue changes.
  const out = recolor('<stop stop-color="#16314a"/>', '#4a90c8', '#c84a4a');
  const hex = out.match(/#[0-9a-f]{6}/)[0];
  const lum = [hex.slice(1,3), hex.slice(3,5), hex.slice(5,7)]
    .map(h => parseInt(h, 16)).reduce((a, b) => a + b, 0) / 3;
  assert.ok(lum < 100, `dark stop should stay dark, got mean ${lum}`);
});

test('recolor shifts multi-tone art by one delta (relationships preserved)', () => {
  // two distinct hues stay distinct after the shift.
  const out = recolor('<a fill="#2a6fb0"/><b fill="#2ab0a0"/>', '#2a6fb0', '#b02a6f');
  const hexes = [...out.matchAll(/#[0-9a-f]{6}/g)].map(m => m[0]);
  assert.equal(hexes.length, 2);
  assert.notEqual(hexes[0], hexes[1], 'the two tones should remain distinct');
});

test('recolor is a no-op for an unrecognized anchor', () => {
  const svg = '<circle fill="#4a90c8"/>';
  assert.equal(recolor(svg, 'not-a-color', '#c84a4a'), svg);
});

test('scanColors returns saturated colors most-frequent first, skipping neutrals', () => {
  const svg = '<a fill="#4a90c8"/><b fill="#4a90c8"/><c fill="#c84a4a"/><d fill="#ffffff"/>';
  const colors = scanColors(svg);
  assert.equal(colors[0], scanColors('<a fill="#4a90c8"/>')[0]); // dominant blue first
  assert.ok(!colors.includes('#ffffff'), 'white is neutral, not an anchor candidate');
  assert.equal(colors.length, 2);
});

test('scanColors collapses near-identical hues to one swatch (3 Tango reds -> 1)', () => {
  // shadow / base / highlight reds for one element, plus a distinct blue.
  const svg = '<a fill="#a40000"/><b fill="#cc0000"/><c fill="#ef2929"/><d fill="#7fb8e8"/>';
  const colors = scanColors(svg);
  assert.equal(colors.length, 2, 'one red family + one blue, not three reds + blue');
});

test('isNeutral flags greys/white/black but not saturated colors', () => {
  assert.ok(isNeutral('#808080') && isNeutral('#ffffff') && isNeutral('#000000'));
  assert.ok(!isNeutral('#cc0000') && !isNeutral('#4a90c8'));
});

test('scanColors includeNeutrals offers the dominant grey as an anchor', () => {
  // grey-dominant art with one red accent: grey is the auto-picked (first) anchor.
  const svg = '<a fill="#555753"/><b fill="#555753"/><c fill="#555753"/><d fill="#a40000"/>';
  const withN = scanColors(svg, { includeNeutrals: true });
  assert.ok(isNeutral(withN[0]), 'dominant grey should be first/auto-picked');
  assert.equal(withN.length, 2, 'one grey rep + one red');
  assert.deepEqual(scanColors(svg).filter(isNeutral), [], 'default scan still hides greys');
});
