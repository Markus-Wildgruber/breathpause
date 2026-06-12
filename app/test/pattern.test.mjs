import { test } from 'node:test';
import assert from 'node:assert';
import Pattern from '../src/core/pattern.js';
import Breathing from '../src/core/breathing.js';

const settings = {
  timers: { workPattern: 'coherent', breakPattern: 'box' },
  patterns: [
    { id: 'coherent', name: 'Coherent', phases: [{ type: 'in', seconds: 5.5 }, { type: 'out', seconds: 5.5 }] },
    { id: 'box', name: 'Box', phases: [
      { type: 'in', seconds: 4 }, { type: 'hold', seconds: 4 },
      { type: 'out', seconds: 4 }, { type: 'hold', seconds: 4 },
    ] },
  ],
  text: { phases: { in: 'In', out: 'Out', hold: 'Hold' } },
};

test('work mode resolves the work pattern with mapped types + labels', () => {
  const p = Pattern.toEnginePattern(settings, 'work');
  assert.deepEqual(p.phases, [
    { type: 'inhale', seconds: 5.5, label: 'In' },
    { type: 'exhale', seconds: 5.5, label: 'Out' },
  ]);
});

test('break mode resolves the break pattern; hold maps to hold', () => {
  const p = Pattern.toEnginePattern(settings, 'break');
  assert.deepEqual(p.phases.map(x => x.type), ['inhale', 'hold', 'exhale', 'hold']);
  assert.deepEqual(p.phases.map(x => x.label), ['In', 'Hold', 'Out', 'Hold']);
});

test('unknown pattern id falls back to the first pattern', () => {
  const s = { ...settings, timers: { workPattern: 'does-not-exist' } };
  const p = Pattern.toEnginePattern(s, 'work');
  assert.equal(p.phases[0].seconds, 5.5); // coherent (patterns[0])
});

test('no patterns at all -> built-in 5.5/5.5 default with default labels', () => {
  const p = Pattern.toEnginePattern({ timers: {}, patterns: [] }, 'work');
  assert.deepEqual(p.phases, [
    { type: 'inhale', seconds: 5.5, label: 'breathe in' },
    { type: 'exhale', seconds: 5.5, label: 'breathe out' },
  ]);
});

test('missing text.phases uses default labels', () => {
  const s = { ...settings, text: undefined };
  const p = Pattern.toEnginePattern(s, 'work');
  assert.deepEqual(p.phases.map(x => x.label), ['breathe in', 'breathe out']);
});

test('label falls back to the phase type when that label is unset', () => {
  const s = { ...settings, text: { phases: { in: 'In' } } };
  const p = Pattern.toEnginePattern(s, 'work');
  assert.deepEqual(p.phases.map(x => x.label), ['In', 'out']); // out label missing -> 'out'
});

test('output is consumable by the breathing engine', () => {
  const p = Pattern.toEnginePattern(settings, 'work');
  assert.equal(Breathing.cycleDuration(p), 11); // 5.5 + 5.5
  assert.equal(Breathing.currentLabel(p, 1), 'In');
  assert.equal(Breathing.currentLabel(p, 6), 'Out');
});
