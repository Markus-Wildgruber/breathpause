import { test } from 'node:test';
import assert from 'node:assert';
import br from '../src/core/breathing.js';

const DEFAULT = { phases: [
  { type: 'inhale', seconds: 3, label: 'Breathe in' },
  { type: 'exhale', seconds: 5, label: 'Breathe out' }
] };

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('easeInOut endpoints and midpoint', () => {
  assert.equal(br.easeInOut(0), 0);
  assert.equal(br.easeInOut(1), 1);
  assert.ok(close(br.easeInOut(0.5), 0.5));
  assert.equal(br.easeInOut(-1), 0);
  assert.equal(br.easeInOut(2), 1);
});

test('cycleDuration sums phases', () => {
  assert.equal(br.cycleDuration(DEFAULT), 8);
  assert.equal(br.cycleDuration({ phases: [] }), 0);
});

test('default pattern: size goes 0 -> 1 -> 0 and is continuous across the loop', () => {
  assert.ok(close(br.sizeAt(DEFAULT, 0), 0));        // start of inhale
  assert.ok(close(br.sizeAt(DEFAULT, 3), 1));        // top, start of exhale
  assert.ok(close(br.sizeAt(DEFAULT, 8), 0));        // end == start (looped)
  assert.ok(br.sizeAt(DEFAULT, 1.5) > 0 && br.sizeAt(DEFAULT, 1.5) < 1);
  // looping: t and t+cycle give the same size
  assert.ok(close(br.sizeAt(DEFAULT, 2), br.sizeAt(DEFAULT, 10)));
});

test('hold keeps the inherited size (box pattern)', () => {
  const box = { phases: [
    { type: 'inhale', seconds: 4, label: 'in' },
    { type: 'hold', seconds: 4, label: 'hold' },
    { type: 'exhale', seconds: 4, label: 'out' },
    { type: 'hold', seconds: 4, label: 'hold' }
  ] };
  assert.ok(close(br.sizeAt(box, 4), 1));     // after inhale
  assert.ok(close(br.sizeAt(box, 6), 1));     // mid top-hold stays at 1
  assert.ok(close(br.sizeAt(box, 8), 1));     // end top-hold still 1
  assert.ok(close(br.sizeAt(box, 12), 0));    // after exhale
  assert.ok(close(br.sizeAt(box, 14), 0));    // bottom-hold stays at 0
});

test('phaseAt reports index/label/remaining', () => {
  const info = br.phaseAt(DEFAULT, 4); // 1s into exhale
  assert.equal(info.index, 1);
  assert.equal(info.phase.label, 'Breathe out');
  assert.ok(close(info.remaining, 4));
  assert.equal(br.currentLabel(DEFAULT, 1), 'Breathe in');
  assert.equal(br.currentLabel(DEFAULT, 5), 'Breathe out');
});

test('empty pattern is safe', () => {
  assert.equal(br.sizeAt({ phases: [] }, 1), 0);
  assert.equal(br.phaseAt({ phases: [] }, 1), null);
  assert.equal(br.currentLabel({ phases: [] }, 1), '');
});

test('diameterForSize maps 0..1 to px range', () => {
  assert.equal(br.diameterForSize(0, 80, 200), 80);
  assert.equal(br.diameterForSize(1, 80, 200), 200);
  assert.equal(br.diameterForSize(0.5, 80, 200), 140);
});

test('all-hold pattern settles to 0', () => {
  const allHold = { phases: [{ type: 'hold', seconds: 2, label: 'h' }] };
  assert.ok(close(br.sizeAt(allHold, 1), 0));
});
