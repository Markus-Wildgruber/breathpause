import { test } from 'node:test';
import assert from 'node:assert';
import { createPauseReasons } from '../src/lib/pause-reasons.js';

test('hidden bubble stays paused through lock and unlock (the reported bug)', () => {
  const r = createPauseReasons();
  r.add('hidden');
  r.add('locked');
  r.remove('locked');              // unlock
  assert.equal(r.paused, true);
  r.remove('hidden');              // shown again
  assert.equal(r.paused, false);
});

test('hiding during a lock pause is remembered (unlock right before hide)', () => {
  const r = createPauseReasons();
  r.add('locked');                 // lock-paused
  r.add('hidden');                 // hidden before the unlock event arrived
  r.remove('locked');              // unlock
  assert.equal(r.paused, true);
});

test('order does not matter, repeats do not stack', () => {
  const r = createPauseReasons();
  r.add('locked'); r.add('locked');
  r.add('hidden');
  r.remove('hidden');
  assert.equal(r.paused, true);    // still locked
  r.remove('locked');
  assert.equal(r.paused, false);
});

test('a manual pause survives hide/show and lock/unlock', () => {
  const r = createPauseReasons();
  r.add('manual');
  r.add('hidden'); r.remove('hidden');
  r.add('locked'); r.remove('locked');
  assert.equal(r.paused, true);
});

test('an explicit resume clears every reason', () => {
  const r = createPauseReasons();
  r.add('hidden'); r.add('locked'); r.add('manual');
  r.clear();
  assert.equal(r.paused, false);
});
