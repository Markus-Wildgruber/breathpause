import { test } from 'node:test';
import assert from 'node:assert';
import { editLayout, editMargin } from '../src/lib/edit-layout.js';

const ROOM = 300, MAX = 480;
// 1920x1080 monitor at the origin, scale 1. Work window = bubble width x (bubble + 64).
function layout(x, sizePx, opts = {}) {
  return editLayout({
    x, y: 40, w: sizePx, h: sizePx + 64, monX: 0, monY: 0, monW: 1920, monH: 1080, sf: 1,
    sizePx, room: ROOM, maxBubble: MAX, ...opts,
  });
}
// Bubble left edge in window CSS px for a given size, and whether controls fit beside it.
function check(l, orig, size) {
  const m = editMargin(l, orig, size, ROOM);
  const controls = l.side === 'left' ? [m - ROOM, m] : [m + size, m + size + ROOM];
  return { m, fits: m >= 0 && m + size <= l.widthCss && controls[0] >= 0 && controls[1] <= l.widthCss };
}

test('small bubble near the right screen edge can grow to max with controls visible', () => {
  const l = layout(1920 - 40 - 100, 100);          // posRight 40, 100px bubble
  assert.equal(l.side, 'left');                    // no room on the right
  assert.equal(l.maxSize, MAX);
  for (const size of [100, 250, MAX]) assert.ok(check(l, 100, size).fits, `size ${size}`);
  // The bubble keeps its right edge on screen while it grows (like the normal layout).
  const screenRight = (size) => l.x + editMargin(l, 100, size, ROOM) + size;
  assert.equal(screenRight(MAX), screenRight(100));
});

test('bubble near the left screen edge: controls on the right, growth shifts it inward', () => {
  const l = layout(10, 100);
  assert.equal(l.side, 'right');
  assert.equal(l.maxSize, MAX);
  for (const size of [100, 300, MAX]) assert.ok(check(l, 100, size).fits, `size ${size}`);
});

test('a short monitor caps the bubble size so it still fits in the window', () => {
  const l = layout(1920 - 40 - 100, 100, { monH: 400 });
  assert.ok(l.maxSize < MAX);
  assert.ok(l.maxSize + 64 <= l.height);
  assert.ok(check(l, 100, l.maxSize).fits);
});

test('maxSize never drops below the current size', () => {
  const l = layout(1920 - 40 - 300, 300, { monH: 200 });
  assert.equal(l.maxSize, 300);
});

test('HiDPI: physical window rect, CSS-px layout values', () => {
  const l = editLayout({ x: 2880 - 80 - 200, y: 80, w: 200, h: 328, monX: 0, monY: 0, monW: 2880, monH: 1800,
                         sf: 2, sizePx: 100, room: ROOM, maxBubble: MAX });
  assert.equal(l.side, 'left');
  assert.equal(l.maxSize, MAX);
  assert.equal(l.widthCss, l.width / 2);
  assert.ok(check(l, 100, MAX).fits);
});
