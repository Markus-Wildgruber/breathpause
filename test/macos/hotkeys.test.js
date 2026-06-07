const { test } = require('node:test');
const assert = require('node:assert');
const hk = require('../../src/macos/core/hotkeys');

test('toVk maps letters/digits/F-keys', () => {
  assert.equal(hk.toVk('P'), 0x50);
  assert.equal(hk.toVk('a'), 0x41);   // uppercased
  assert.equal(hk.toVk('5'), 0x35);
  assert.equal(hk.toVk('F1'), 0x70);
  assert.equal(hk.toVk('F12'), 0x7B);
  assert.equal(hk.toVk('F13'), null);
  assert.equal(hk.toVk('++'), null);
});

test('parse: valid combos', () => {
  assert.deepEqual(hk.parse('Ctrl+Alt+P'), { mods: [0x11, 0x12], vk: 0x50, down: false });
  assert.deepEqual(hk.parse('Ctrl+Shift+F3'), { mods: [0x11, 0x10], vk: 0x72, down: false });
  assert.deepEqual(hk.parse('Win+Q'), { mods: [0x5B], vk: 0x51, down: false });
  assert.deepEqual(hk.parse('control+5'), { mods: [0x11], vk: 0x35, down: false });
});

test('parse: rejects bare key, empty, modifier-only', () => {
  assert.equal(hk.parse('P'), null);     // no modifier
  assert.equal(hk.parse(''), null);
  assert.equal(hk.parse(null), null);
  assert.equal(hk.parse('Ctrl+Alt'), null); // no main key
});
