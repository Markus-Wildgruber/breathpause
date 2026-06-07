const { test } = require('node:test');
const assert = require('node:assert');
const st = require('../../src/macos/core/settings');

test('defaults match the SPEC schema', () => {
  const d = st.defaults();
  assert.equal(d.version, 1);
  assert.equal(d.workPatternId, 'coherent-5-5');
  assert.equal(d.timers.work, '00:25');
  assert.equal(d.timers.break, '05:00');
  assert.equal(d.appearance.collapsedDiameterPx, 80);
  assert.equal(d.appearance.opacity, 0.20);
  assert.equal(d.behavior.autoStartTimerOnLaunch, true);
  assert.ok(st.validatePattern(d.patterns[0]));
  // added settings
  assert.equal(d.timers.longBreak, '15:00');
  assert.equal(d.cycle.longBreakEvery, 4);
  assert.equal(d.cycle.autoContinue, true);
  assert.equal(d.longBreakPatternId, 'coherent-5-5');
  assert.equal(d.appearance.showLabel, true);
  assert.equal(d.appearance.font.family, 'Segoe UI Variable');
  assert.equal(d.appearance.font.size, 16);
  assert.equal(d.appearance.font.countdownSize, 13);
  assert.equal(d.appearance.font.pomodoroSize, 12);
  assert.equal(d.behavior.startOnBoot, false);
  assert.deepEqual(Object.keys(d.hotkeys).sort(), ['pauseResume', 'settings', 'skip', 'startStop']);
});

test('normalize clamps longBreakEvery, font size; rejects bad longBreak timer', () => {
  const s = st.normalize({
    cycle: { longBreakEvery: 999 },
    timers: { longBreak: 'nope' },
    appearance: { font: { family: '', size: 999 } },
    behavior: { startOnBoot: true }
  });
  assert.equal(s.cycle.longBreakEvery, 99);
  assert.equal(s.timers.longBreak, '15:00');           // invalid -> default
  assert.equal(s.appearance.font.family, 'Segoe UI Variable'); // empty -> default
  assert.equal(s.appearance.font.size, 72);            // clamped
  assert.equal(s.behavior.startOnBoot, true);
});

test('appVersion is a semver-ish string, distinct from schema version', () => {
  assert.match(st.appVersion(), /^\d+\.\d+\.\d+$/);
  assert.equal(st.defaults().version, 1); // schema version stays a number
});

test('per-text font sizes migrate from legacy size when absent', () => {
  const s = st.normalize({ appearance: { font: { size: 20 } } });
  assert.equal(s.appearance.font.size, 20);
  assert.equal(s.appearance.font.countdownSize, 16); // round(20 * 0.8)
  assert.equal(s.appearance.font.pomodoroSize, 14);  // round(20 * 0.72)
});

test('per-text font sizes are kept and clamped when present', () => {
  const s = st.normalize({ appearance: { font: { size: 16, countdownSize: 30, pomodoroSize: 999 } } });
  assert.equal(s.appearance.font.countdownSize, 30);
  assert.equal(s.appearance.font.pomodoroSize, 72); // clamped
});

test('validatePattern rejects bad patterns', () => {
  assert.ok(!st.validatePattern(null));
  assert.ok(!st.validatePattern({ id: 'x', phases: [] }));
  assert.ok(!st.validatePattern({ id: 'x', phases: [{ type: 'sniff', seconds: 1 }] }));
  assert.ok(!st.validatePattern({ id: 'x', phases: [{ type: 'inhale', seconds: 0 }] }));
  assert.ok(!st.validatePattern({ id: 'x', phases: [{ type: 'inhale', seconds: 61 }] }));
  assert.ok(st.validatePattern({ id: 'x', phases: [{ type: 'hold', seconds: 0.1 }] }));
});

test('normalize fills missing fields from defaults', () => {
  const s = st.normalize({});
  assert.deepEqual(s, st.defaults());
});

test('normalize clamps out-of-range numbers and bad colors', () => {
  const s = st.normalize({
    appearance: { opacity: 5, collapsedDiameterPx: -10, expandedDiameterPx: 50,
      breakSizePctScreenHeight: 999, colors: { workFill: 'red', text: '#FFFFFF' } }
  });
  assert.equal(s.appearance.opacity, 1);
  assert.equal(s.appearance.collapsedDiameterPx, 8);
  // expanded < collapsed gets bumped up to collapsed
  assert.equal(s.appearance.expandedDiameterPx, 50);
  assert.equal(s.appearance.breakSizePctScreenHeight, 100);
  assert.equal(s.appearance.colors.workFill, st.defaults().appearance.colors.workFill); // invalid -> default
  assert.equal(s.appearance.colors.text, '#FFFFFF'); // valid kept
});

test('normalize rejects invalid timer strings, keeps valid', () => {
  const s = st.normalize({ timers: { work: '00:00', break: '03:30' } });
  assert.equal(s.timers.work, '00:25'); // invalid -> default
  assert.equal(s.timers.break, '03:30');
});

test('normalize drops invalid patterns but keeps valid ones', () => {
  const s = st.normalize({
    patterns: [
      { id: 'good', name: 'g', phases: [{ type: 'inhale', seconds: 2, label: 'in' }] },
      { id: 'bad', phases: [] }
    ],
    workPatternId: 'good', breakPatternId: 'missing'
  });
  assert.equal(s.patterns.length, 1);
  assert.equal(s.workPatternId, 'good');
  assert.equal(s.breakPatternId, 'good'); // missing id falls back to first pattern
});

test('pattern resolution helpers', () => {
  const s = st.defaults();
  assert.equal(st.getWorkPattern(s).id, 'coherent-5-5');
  assert.equal(st.getBreakPattern(s).id, 'coherent-5-5');
  assert.equal(st.findPattern(s, 'nope'), null);
});

test('parse: bad JSON falls back to defaults; good JSON normalizes', () => {
  assert.deepEqual(st.parse('not json{'), st.defaults());
  const round = st.parse(st.serialize(st.defaults()));
  assert.deepEqual(round, st.defaults());
});

test('isHexColor', () => {
  assert.ok(st.isHexColor('#aabbcc'));
  assert.ok(st.isHexColor('#AABBCCDD'));
  assert.ok(!st.isHexColor('#abc'));
  assert.ok(!st.isHexColor('blue'));
});

test('position defaults to 16px from the top-right corner', () => {
  const d = st.defaults();
  assert.equal(d.position.fromRight, 16);
  assert.equal(d.position.fromTop, 16);
});

test('position clamps negatives to zero and falls back on non-number', () => {
  const s = st.normalize({ position: { fromRight: -5, fromTop: 'x' } });
  assert.equal(s.position.fromRight, 0);
  assert.equal(s.position.fromTop, 16);
});
