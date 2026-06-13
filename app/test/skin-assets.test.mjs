// Integration test: drive the real recolor pipeline against the actual bundled skin
// assets (skin.json manifest + skin.svg art), exactly as mountSkin would. Validates the
// claims made about recolor behavior on real art, not hand-picked toy colors.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { recolor, scanColors, isNeutral } from '../src/lib/skin.js';

function load(skinId) {
  const dir = new URL(`../public/skins/${skinId}/`, import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('skin.json', dir), 'utf8'));
  const svg = readFileSync(new URL(manifest.svg || 'skin.svg', dir), 'utf8');
  return { manifest, svg };
}
const count = (s, hex) => (s.match(new RegExp(hex, 'gi')) || []).length;
const meanLum = (svg) => {
  const hexes = [...svg.matchAll(/#[0-9a-f]{6}/gi)].map(m => m[0]);
  const lum = h => (parseInt(h.slice(1,3),16) + parseInt(h.slice(3,5),16) + parseInt(h.slice(5,7),16)) / 3;
  return hexes.reduce((a, h) => a + lum(h), 0) / hexes.length;
};

test('seal manifest: neutral-grey anchor + whole-body tinting', () => {
  const { manifest } = load('sleepy-seal');
  assert.equal(manifest.themeColor, '#888a85'); // grey body anchor, so the default Color reads grey
  assert.equal(manifest.tintNeutrals, true);
});

test('seal: a green color recolors the grey body AND the red tongue', () => {
  const { manifest, svg } = load('sleepy-seal');
  // sanity: the art really is a grey seal with a red tongue
  assert.ok(count(svg, '#555753') > 0 && count(svg, '#a40000') > 0);

  const out = recolor(svg, manifest.themeColor, '#33aa33', manifest.tintNeutrals);
  assert.equal(count(out, '#555753'), 0, 'grey body shading should be recolored');
  assert.equal(count(out, '#d3d7cf'), 0, 'light grey body should be recolored');
  assert.equal(count(out, '#a40000'), 0, 'red tongue should be recolored');
  // the result should actually contain greens (hue ~120)
  const greens = [...out.matchAll(/#[0-9a-f]{6}/gi)].map(m => m[0].toLowerCase())
    .filter(h => { const g = parseInt(h.slice(3,5),16); return g > parseInt(h.slice(1,3),16) && g > parseInt(h.slice(5,7),16); });
  assert.ok(greens.length > 0, 'recolored seal should contain green tones');
});

test('seal: a dark color darkens the whole seal, a light color lightens it (lightness counts)', () => {
  const { manifest, svg } = load('sleepy-seal');
  const before = meanLum(svg);
  const dark  = recolor(svg, manifest.themeColor, '#111111', manifest.tintNeutrals);
  const light = recolor(svg, manifest.themeColor, '#eeeeee', manifest.tintNeutrals);
  assert.ok(meanLum(dark) < before, 'a near-black color should darken the seal');
  assert.ok(meanLum(light) > before, 'a near-white color should lighten the seal');
});

test('seal: black and white colors now produce different results (lightness applies)', () => {
  // The fix for "#000000 looks gray": lightness is now part of the shift, so black and
  // white are no longer the identical grey they used to collapse to.
  const { manifest, svg } = load('sleepy-seal');
  const black = recolor(svg, manifest.themeColor, '#000000', manifest.tintNeutrals);
  const white = recolor(svg, manifest.themeColor, '#ffffff', manifest.tintNeutrals);
  assert.notEqual(black, white, 'black and white colors must differ');
  assert.ok(meanLum(black) < meanLum(white), 'black color is darker than white color');
});

test('seal picker shows one red + one blue, no greys (dedup + neutral skip)', () => {
  const { svg } = load('sleepy-seal');
  const swatches = scanColors(svg);
  assert.equal(swatches.length, 2, 'three Tango reds collapse to one; plus the bubble blue');
});

test('importing cute-baby-seal anchors on grey (the user-reported "still red" fix)', () => {
  // The actual file the user imports lives in skins-src/. Its only saturated color is red.
  const svg = readFileSync(new URL('../skins-src/cute-baby-seal.svg', import.meta.url), 'utf8');
  const picker = scanColors(svg, { includeNeutrals: true });
  assert.ok(isNeutral(picker[0]), `auto-picked anchor should be grey, got ${picker[0]}`);
  // the old default (no neutrals) is exactly what made it "still red":
  assert.ok(scanColors(svg).every(c => !isNeutral(c)), 'default scan only offered saturated colors');
});

test('orb: a red color shifts the blue gradient but keeps the white highlight', () => {
  const { manifest, svg } = load('orb');
  assert.equal(manifest.themeColor, '#4a90c8');
  assert.ok(!manifest.tintNeutrals, 'orb does NOT tint neutrals');
  const whiteBefore = count(svg, '#ffffff');
  const out = recolor(svg, manifest.themeColor, '#c84a4a', manifest.tintNeutrals);
  assert.equal(count(out, '#4a90c8'), 0, 'the blue anchor stop should shift');
  assert.equal(count(out, '#ffffff'), whiteBefore, 'orb white highlight stays white');
});
