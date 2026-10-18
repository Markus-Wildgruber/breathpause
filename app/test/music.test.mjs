import { test } from 'node:test';
import assert from 'node:assert';
import { SOUNDS, HOLDS, toTimeline, locate, phrase, KURD, musicStep, createMusic } from '../src/lib/music.js';

// A stand-in Web Audio context: every node/param/method is a do-nothing proxy; only the clock
// state (running/suspended) is real, which is what these tests are about.
function fakeNode() {
  return new Proxy(function () {}, {
    get: (t, k) => (k === 'then' ? undefined : k in t ? t[k] : fakeNode()),
    apply: () => fakeNode(),
    set: () => true,
  });
}
class FakeAudioContext {
  constructor() {
    this.state = 'running'; this.currentTime = 0; this.sampleRate = 4000; this.destination = fakeNode();
    return new Proxy(this, { get: (t, k) => (k in t ? t[k] : () => fakeNode()) });
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
}

const BOX = [
  { type: 'inhale', seconds: 4 }, { type: 'hold', seconds: 4 },
  { type: 'exhale', seconds: 4 }, { type: 'hold', seconds: 4 },
];

test('all seven sounds and five hold styles from the preview are offered', () => {
  assert.deepEqual(SOUNDS.map((s) => s.id),
    ['handpan', 'handpan-calm', 'notes', 'kalimba', 'piano', 'flute', 'waves']);
  assert.deepEqual(HOLDS.map((h) => h.id), ['ring', 'pulse', 'countdown', 'chimes', 'sustain']);
  for (const x of [...SOUNDS, ...HOLDS]) assert.ok(x.name);
});

test('timeline: engine phases become in/out/hold with breath levels; empty phases are dropped', () => {
  const tl = toTimeline([...BOX, { type: 'hold', seconds: 0 }]);
  assert.deepEqual(tl.map((p) => [p.type, p.sec, p.l0, p.l1]), [
    ['in', 4, 0, 1], ['hold', 4, 1, 1], ['out', 4, 1, 0], ['hold', 4, 0, 0],
  ]);
});

test('locate: finds the phase and how far into it, wrapping around the cycle', () => {
  const tl = toTimeline(BOX);
  assert.deepEqual(locate(tl, 0), { idx: 0, offset: 0 });
  assert.deepEqual(locate(tl, 5), { idx: 1, offset: 1 });
  assert.deepEqual(locate(tl, 16 + 9.5), { idx: 2, offset: 1.5 });   // second cycle
});

test('phrases fit their phase, repeat exactly, and head the right way', () => {
  for (const [type, goal] of [['in', KURD.length - 1], ['out', 2]]) {
    const a = phrase(type, 4, 0.34), b = phrase(type, 4, 0.34);
    assert.deepEqual(a, b, 'same phase, same notes, every cycle');
    assert.ok(a.every((n) => n.at >= 0 && n.at < 4), 'all notes inside the phase');
    assert.ok(a.length >= 10, 'flowing, not a handful of notes');
    // the last main note (not the optional strike under it) lands on the goal
    const main = a.filter((n) => !n.under);
    assert.equal(main[main.length - 1].f, KURD[goal]);
  }
  assert.ok(phrase('in', 4, 0.72).length < phrase('in', 4, 0.34).length, 'calm is sparser');
});

test('pausing stops the bubble following the audio clock at once (no breathing on after Pause)', () => {
  globalThis.window = { AudioContext: FakeAudioContext };
  const m = createMusic();
  m.start([{ type: 'inhale', seconds: 4 }, { type: 'exhale', seconds: 4 }], 0);
  assert.equal(m.running, true);
  m.pause();                         // the fade-out still runs, but the clock must not drive the bubble
  assert.equal(m.running, false);
  assert.equal(m.paused, true);
  m.stop();
});

test('musicStep: never starts music while the timer is paused', () => {
  const base = { on: true, paused: false, playing: true, musicPaused: false, keyChanged: false };
  const step = (o) => musicStep({ ...base, ...o });
  assert.equal(step({ on: false }), 'stop');
  assert.equal(step({}), 'none');
  assert.equal(step({ playing: false }), 'start');                  // turned on
  assert.equal(step({ keyChanged: true }), 'start');                // new sound / hold / pattern
  assert.equal(step({ musicPaused: true }), 'start');               // resume: restart in sync with the bubble
  // paused timer: fade out, or drop a stale sound so resume starts the new one; no 'start'
  assert.equal(step({ paused: true }), 'pause');
  assert.equal(step({ paused: true, keyChanged: true }), 'stop');
  assert.equal(step({ paused: true, playing: false }), 'none');
  assert.equal(step({ paused: true, playing: false, keyChanged: true }), 'none');
});
