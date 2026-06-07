const { test } = require('node:test');
const assert = require('node:assert');
const el = require('../../src/macos/core/eventlog');

test('isValidEvent matches the SPEC event set', () => {
  assert.ok(el.isValidEvent('session_start'));
  assert.ok(el.isValidEvent('work_complete'));
  assert.ok(el.isValidEvent('quit'));
  assert.ok(!el.isValidEvent('nope'));
  assert.equal(el.EVENTS.length, 9);
});

test('makeEvent builds ts+event and merges extra', () => {
  const rec = el.makeEvent('break_start', '2026-06-03T10:00:00.000Z', { mode: 'break', cycle: 2 });
  assert.deepEqual(rec, { ts: '2026-06-03T10:00:00.000Z', event: 'break_start', mode: 'break', cycle: 2 });
});

test('makeEvent ignores attempts to override ts/event via extra', () => {
  const rec = el.makeEvent('pause', 'T', { ts: 'X', event: 'Y', note: 'ok' });
  assert.equal(rec.ts, 'T');
  assert.equal(rec.event, 'pause');
  assert.equal(rec.note, 'ok');
});

test('makeEvent tolerates missing/non-object extra', () => {
  assert.deepEqual(el.makeEvent('resume', 'T'), { ts: 'T', event: 'resume' });
  assert.deepEqual(el.makeEvent('resume', 'T', null), { ts: 'T', event: 'resume' });
});

test('serialize produces single-line JSON', () => {
  const line = el.serialize(el.makeEvent('quit', 'T'));
  assert.equal(line, '{"ts":"T","event":"quit"}');
  assert.ok(line.indexOf('\n') === -1);
});
