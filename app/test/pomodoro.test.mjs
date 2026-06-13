import { test } from 'node:test';
import assert from 'node:assert';
import pomo from '../src/core/pomodoro.js';

const init = () => pomo.initState(1500, 300); // 25:00 work, 05:00 break

test('initState auto-starts in work mode', () => {
  const s = init();
  assert.equal(s.running, true);
  assert.equal(s.mode, 'work');
  assert.equal(s.remaining, 1500);
  assert.equal(s.paused, false);
  assert.equal(s.cyclesCompleted, 0);
});

test('tick decrements remaining without mutating input', () => {
  const s = init();
  const r = pomo.tick(s, 10);
  assert.equal(r.state.remaining, 1490);
  assert.equal(r.events.length, 0);
  assert.equal(s.remaining, 1500); // original untouched
});

test('work -> break boundary fires work_complete + break_start', () => {
  let s = init();
  const r = pomo.tick(s, 1500);
  assert.equal(r.state.mode, 'break');
  assert.equal(r.state.remaining, 300);
  assert.deepEqual(r.events, ['work_complete', 'break_start']);
});

test('full cycle loops back to work and counts the cycle', () => {
  let s = init();
  const r = pomo.tick(s, 1500 + 300); // through work and break
  assert.equal(r.state.mode, 'work');
  assert.equal(r.state.remaining, 1500);
  assert.equal(r.state.cyclesCompleted, 1);
  assert.deepEqual(r.events, ['work_complete', 'break_start', 'break_complete', 'session_start']);
});

test('limitFrameDt passes a normal small frame delta through', () => {
  assert.equal(pomo.limitFrameDt(0.033, 2.0), 0.033);
});

test('limitFrameDt clamps a large (sleep/hibernate) gap to the cap', () => {
  assert.equal(pomo.limitFrameDt(7200, 2.0), 2.0);
  assert.equal(pomo.limitFrameDt(2.0, 2.0), 2.0); // exact boundary
});

test('limitFrameDt floors a negative delta to zero', () => {
  assert.equal(pomo.limitFrameDt(-5, 2.0), 0);
});

test('large dt carries across multiple boundaries', () => {
  let s = init();
  const r = pomo.tick(s, 1500 + 300 + 1500 + 300 + 10); // two full cycles + 10s into work
  assert.equal(r.state.mode, 'work');
  assert.equal(r.state.cyclesCompleted, 2);
  assert.equal(r.state.remaining, 1490);
});

test('pause freezes the clock; resume unfreezes', () => {
  let s = pomo.pause(init());
  assert.equal(s.paused, true);
  const frozen = pomo.tick(s, 100);
  assert.equal(frozen.state.remaining, 1500);
  assert.equal(frozen.events.length, 0);
  s = pomo.resume(frozen.state);
  assert.equal(pomo.tick(s, 100).state.remaining, 1400);
});

test('skip ends the current segment immediately', () => {
  const r = pomo.skip(init());
  assert.equal(r.state.mode, 'break');
  assert.deepEqual(r.events, ['work_complete', 'break_start']);
});

test('reset stops the session back to breathing-only work', () => {
  let s = pomo.tick(init(), 1500).state; // now in break
  const r = pomo.reset(s);
  assert.equal(r.running, false);
  assert.equal(r.mode, 'work');
  assert.equal(r.remaining, 1500);
  // a stopped session does not advance
  assert.equal(pomo.tick(r, 100).state.remaining, 1500);
  assert.equal(pomo.skip(r).events.length, 0);
});

test('segmentLength reports per-mode length', () => {
  const s = init();
  assert.equal(pomo.segmentLength(s, 'work'), 1500);
  assert.equal(pomo.segmentLength(s, 'break'), 300); // short by default
});

test('long break every N rounds: Nth break is long', () => {
  let s = pomo.initState(100, 10, 30, 2); // work=100, short=10, long=30, every 2
  s = pomo.tick(s, 100).state;            // finish work #1 -> short break
  assert.equal(s.mode, 'break');
  assert.equal(s.breakKind, 'short');
  assert.equal(s.remaining, 10);
  s = pomo.tick(s, 10).state;             // finish break -> work
  assert.equal(s.workCount, 1);
  assert.equal(s.cyclesCompleted, 1);
  s = pomo.tick(s, 100).state;            // finish work #2 -> LONG break
  assert.equal(s.breakKind, 'long');
  assert.equal(s.remaining, 30);
  assert.equal(pomo.segmentLength(s, 'break'), 30);
});

test('longBreakEvery 0 disables long breaks', () => {
  let s = pomo.initState(100, 10, 30, 0);
  for (let i = 0; i < 3; i++) {
    s = pomo.tick(s, 100).state;
    assert.equal(s.breakKind, 'short');
    s = pomo.tick(s, s.remaining).state;
  }
});

test('autoContinue=false pauses the next segment until Resume', () => {
  let s = pomo.initState(100, 10, 30, 0, false);
  s = pomo.tick(s, 100).state;              // work done -> break, but paused
  assert.equal(s.mode, 'break');
  assert.equal(s.paused, true);
  assert.equal(s.remaining, 10);
  assert.equal(pomo.tick(s, 5).state.remaining, 10); // paused: no advance
  s = pomo.resume(s);
  s = pomo.tick(s, 10).state;               // break done -> work, paused again
  assert.equal(s.mode, 'work');
  assert.equal(s.paused, true);
});

test('autoContinue default true loops without pausing', () => {
  let s = pomo.initState(100, 10, 30, 0);
  s = pomo.tick(s, 110).state;              // through work + break
  assert.equal(s.paused, false);
  assert.equal(s.mode, 'work');
});

test('default initState (no long-break args) keeps every break short', () => {
  let s = pomo.initState(1500, 300);
  assert.equal(s.longBreakEvery, 0);
  s = pomo.tick(s, 1500).state;
  assert.equal(s.breakKind, 'short');
  assert.equal(s.remaining, 300);
});

test('applyConfig keeps the live countdown when the work timer is unchanged', () => {
  let s = init();
  s = pomo.tick(s, 600).state;                         // 10:00 into work, 900s left
  s = pomo.applyConfig(s, { workSeconds: 1500, breakSeconds: 600 }); // same work, longer break
  assert.equal(s.remaining, 900);                      // countdown NOT reset
  assert.equal(s.breakSeconds, 600);                   // new break still takes effect next round
});

test('applyConfig restarts only the current segment when its own length changes', () => {
  let s = init();
  s = pomo.tick(s, 600).state;                         // work, 900s left
  s = pomo.applyConfig(s, { workSeconds: 1200 });      // current (work) segment length changed
  assert.equal(s.remaining, 1200);
});

test('applyConfig preserves mode, paused and counters', () => {
  let s = pomo.initState(1500, 300, 900, 4);
  s = pomo.tick(s, 1500).state;                        // -> break
  s = pomo.pause(s);
  s = pomo.applyConfig(s, { workSeconds: 3000 });      // changing work while on break
  assert.equal(s.mode, 'break');
  assert.equal(s.paused, true);
  assert.equal(s.remaining, 300);                      // break countdown untouched
  assert.equal(s.workCount, 1);
});
