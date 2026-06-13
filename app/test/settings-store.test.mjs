import { test } from 'node:test';
import assert from 'node:assert';
import {
  DEFAULT_SETTINGS, DEFAULT_PATTERNS, MODES, modeKey, loadSettings, saveSettings, newSkinId,
  applyPatternResult,
} from '../src/lib/settings-store.js';

const KEY = 'breathpause.settings';

// Minimal localStorage stub keyed by name (settings-store reads/writes the global).
function setStored(value) {
  const data = {};
  if (value !== undefined && value !== null) {
    data[KEY] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  globalThis.localStorage = {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
  };
}

test('no stored settings -> a fresh copy of the defaults', () => {
  setStored(null);
  const s = loadSettings();
  assert.deepEqual(s, DEFAULT_SETTINGS);
  // must be a clone, not the shared default object
  assert.notEqual(s, DEFAULT_SETTINGS);
  assert.notEqual(s.appearance.work, DEFAULT_SETTINGS.appearance.work);
});

test('defaults carry the current schema (in/out labels + text offsets)', () => {
  setStored(null);
  const s = loadSettings();
  assert.equal(s.text.phases.in, 'In');
  assert.equal(s.text.phases.out, 'Out');
  assert.equal(s.text.phases.hold, 'Hold');
  for (const m of MODES) {
    assert.equal(s.appearance[m].textOffsetX, 0);
    assert.equal(s.appearance[m].textOffsetY, 0);
  }
});

test('corrupted JSON falls back to defaults', () => {
  setStored('{ this is not json');
  const s = loadSettings();
  assert.deepEqual(s, DEFAULT_SETTINGS);
});

test('partial text.phases merges onto defaults', () => {
  setStored({ text: { phases: { in: 'Inhale' } } });
  const s = loadSettings();
  assert.equal(s.text.phases.in, 'Inhale');   // stored wins
  assert.equal(s.text.phases.out, 'Out');      // default kept
  assert.equal(s.text.phases.hold, 'Hold');    // default kept
});

test('old appearance without new fields gets new defaults filled in', () => {
  setStored({ appearance: { work: { skin: 'orb', sizePx: 300 } } });
  const s = loadSettings();
  assert.equal(s.appearance.work.sizePx, 300);       // stored wins
  assert.equal(s.appearance.work.skin, 'orb');        // stored wins
  assert.equal(s.appearance.work.textOffsetX, 0);     // new field defaulted
  assert.equal(s.appearance.work.opacity, 0.95);      // untouched default kept
  // break mode, absent from storage, is the full default
  assert.equal(s.appearance.break.skin, 'sleepy-seal');
});

test('timers merge: stored keys win, missing keys keep defaults', () => {
  setStored({ timers: { workSeconds: 999 } });
  const s = loadSettings();
  assert.equal(s.timers.workSeconds, 999);
  assert.equal(s.timers.breakSeconds, DEFAULT_SETTINGS.timers.breakSeconds);
});

test('theme: valid override accepted, garbage ignored', () => {
  setStored({ theme: 'dark' });
  assert.equal(loadSettings().theme, 'dark');
  setStored({ theme: 'chartreuse' });
  assert.equal(loadSettings().theme, null);
});

test('patterns: non-empty array replaces, empty array keeps defaults', () => {
  const custom = [{ id: 'x', name: 'X', phases: [{ type: 'in', seconds: 3 }] }];
  setStored({ patterns: custom });
  assert.deepEqual(loadSettings().patterns, custom);

  setStored({ patterns: [] });
  assert.deepEqual(loadSettings().patterns, DEFAULT_PATTERNS);
});

test('customSkins array is loaded', () => {
  const skins = [{ id: 'c1', name: 'Mine', svgText: '<svg/>' }];
  setStored({ customSkins: skins });
  assert.deepEqual(loadSettings().customSkins, skins);
});

// --- importing the same SVG twice must never crash the keyed skin list ---

test('newSkinId produces unique ids across rapid calls (same-SVG double import)', () => {
  const ids = Array.from({ length: 1000 }, () => newSkinId());
  assert.equal(new Set(ids).size, 1000, 'every generated id is unique');
  assert.ok(ids.every(id => id.startsWith('custom-')));
});

test('two imports of the same SVG yield two entries with distinct ids', () => {
  // Mirror what confirmImport persists for the same file imported twice.
  const svgText = '<svg><rect fill="#555753"/></svg>';
  const skins = [
    { id: newSkinId(), name: 'Cute-baby-seal', svgText, themeColor: '#555753', tintNeutrals: true },
    { id: newSkinId(), name: 'Cute-baby-seal', svgText, themeColor: '#555753', tintNeutrals: true },
  ];
  setStored({ customSkins: skins });
  const { customSkins } = loadSettings();
  assert.equal(customSkins.length, 2);
  assert.equal(new Set(customSkins.map(c => c.id)).size, 2, 'ids distinct -> no each_key_duplicate');
});

test('a corrupted store with duplicate skin ids is repaired on load', () => {
  // Pre-fix state: two imports collided on the same id. Load must make them unique.
  const dup = { id: 'custom-1', name: 'Seal', svgText: '<svg/>' };
  setStored({ customSkins: [dup, { ...dup }] });
  const { customSkins } = loadSettings();
  assert.equal(customSkins.length, 2, 'both kept');
  assert.equal(new Set(customSkins.map(c => c.id)).size, 2, 'ids de-duplicated');
});

test('malformed customSkins entries are dropped, missing ids assigned', () => {
  setStored({ customSkins: [
    { name: 'NoId', svgText: '<svg/>' },   // missing id -> assigned
    { id: 'broken', name: 'Bad' },          // no svgText -> dropped
    'garbage',                              // not an object -> dropped
  ]});
  const { customSkins } = loadSettings();
  assert.equal(customSkins.length, 1, 'only the well-formed entry survives');
  assert.ok(customSkins[0].id, 'a missing id was assigned');
  assert.ok(customSkins.every(c => typeof c.svgText === 'string'));
});

test('saveSettings round-trips a modified value through loadSettings', () => {
  setStored(null);
  const s = loadSettings();
  s.timers.workSeconds = 1234;
  s.appearance.work.textOffsetY = 50;
  saveSettings(s);
  const reloaded = loadSettings();
  assert.equal(reloaded.timers.workSeconds, 1234);
  assert.equal(reloaded.appearance.work.textOffsetY, 50);
});

// --- pattern editor result -> settings (the "save new pattern" flow) ---

test('applyPatternResult appends a new pattern (id not present) without mutating input', () => {
  const patterns = [{ id: 'a', name: 'A', phases: [] }];
  const out = applyPatternResult(patterns, { workPattern: 'a', breakPattern: 'a' },
    { id: 'p1', name: 'New', phases: [{ type: 'in', seconds: 4 }] });
  assert.equal(out.patterns.length, 2);
  assert.ok(out.patterns.some((p) => p.id === 'p1'), 'new pattern appended');
  assert.equal(patterns.length, 1, 'input array not mutated');
});

test('applyPatternResult replaces an existing pattern by id', () => {
  const out = applyPatternResult([{ id: 'a', name: 'A', phases: [] }], {},
    { id: 'a', name: 'A2', phases: [{ type: 'out', seconds: 6 }] });
  assert.equal(out.patterns.length, 1);
  assert.equal(out.patterns[0].name, 'A2');
});

test('applyPatternResult deletes and re-points work/break selection', () => {
  const out = applyPatternResult([{ id: 'a' }, { id: 'b' }],
    { workPattern: 'a', breakPattern: 'a' }, { id: 'a', deleted: true });
  assert.deepEqual(out.patterns.map((p) => p.id), ['b']);
  assert.equal(out.timers.workPattern, 'b');
  assert.equal(out.timers.breakPattern, 'b');
});

test('saving a NEW pattern from the editor persists it (the reported bug)', () => {
  // Before the fix the editor result was only kept in the Settings window's memory and lost
  // unless the user also hit Settings > Save. The handler now persists immediately.
  setStored(null);
  const s = loadSettings();
  const result = { id: 'p-new', name: 'My Pattern', phases: [{ type: 'in', seconds: 5.5 }] };
  const next = applyPatternResult(s.patterns, s.timers, result);
  saveSettings({ ...s, patterns: next.patterns, timers: next.timers });
  const reloaded = loadSettings();
  assert.ok(reloaded.patterns.some((p) => p.id === 'p-new'), 'new pattern survives a reload');
});

test('modeKey maps break to break and everything else to work', () => {
  assert.equal(modeKey('break'), 'break');
  assert.equal(modeKey('work'), 'work');
  assert.equal(modeKey('anything'), 'work');
});
