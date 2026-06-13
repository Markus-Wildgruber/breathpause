// Mirrors test/win/strings.Tests.ps1. Run: node --test test/macos
import { test } from 'node:test';
import assert from 'node:assert';
import st from '../src/core/strings.js';

test('defaults expose tray + break chrome strings', () => {
  const d = st.defaults();
  assert.equal(d.version, 1);
  assert.equal(d.tray.startTimer, 'Start timer');
  assert.equal(d.tray.exit, 'Exit');
  assert.equal(d.break.endBreak, 'End break');
  assert.equal(d.break.confirmTitle, 'End the break?');
});

test('normalize fills missing/blank keys from defaults', () => {
  const s = st.normalize({ tray: { pause: 'Pausieren', skip: '' }, break: { endBreak: 'Pause beenden' } });
  assert.equal(s.tray.pause, 'Pausieren');      // kept
  assert.equal(s.tray.skip, 'Skip');            // blank -> default
  assert.equal(s.tray.settings, 'Settings');    // missing -> default
  assert.equal(s.break.endBreak, 'Pause beenden'); // kept
  assert.equal(s.break.cancel, 'Cancel');       // missing -> default
});

test('parse: bad JSON falls back to defaults; round-trips good JSON', () => {
  assert.deepEqual(st.parse('not json'), st.defaults());
  const custom = st.normalize({ tray: { exit: 'Beenden' } });
  assert.deepEqual(st.parse(st.serialize(custom)), custom);
});
