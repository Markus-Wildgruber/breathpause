import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { compareVersions, notesProblems, releaseProblems } from '../../scripts/release.mjs';

const ready = {
  version: '0.2.0', notes: '## Highlights\n- Something new', tags: ['v0.1.0'],
  branch: 'main', dirty: false, behind: false,
};

test('release: a version with notes, newer than every tag, on a clean up-to-date main is ready', () => {
  assert.deepEqual(releaseProblems(ready), []);
});

test('release: missing or empty notes block the release', () => {
  assert.match(releaseProblems({ ...ready, notes: null }).join(), /release-notes\/v0\.2\.0\.md missing/);
  assert.match(releaseProblems({ ...ready, notes: '## Highlights\n' }).join(), /no bullet points/);
});

test('release: the tag must be new and newer than the latest one', () => {
  assert.match(releaseProblems({ ...ready, tags: ['v0.1.0', 'v0.2.0'] }).join(), /already exists/);
  assert.match(releaseProblems({ ...ready, tags: ['v0.10.0'] }).join(), /not newer than the latest tag v0\.10\.0/);
  assert.match(releaseProblems({ ...ready, version: '0.2' }).join(), /not a version/);
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0);   // numeric, not alphabetical
});

test('release: only from a clean main that matches GitHub', () => {
  const p = releaseProblems({ ...ready, branch: 'feat/x', dirty: true, behind: true }).join('\n');
  assert.match(p, /not main/);
  assert.match(p, /uncommitted/);
  assert.match(p, /not up to date/);
});

test('release: every file in release-notes/ is named v<version>.md and has real notes', () => {
  const dir = new URL('../../release-notes/', import.meta.url);
  const files = readdirSync(dir);
  assert.ok(files.length > 0, 'release-notes/ is empty');
  for (const f of files) {
    assert.match(f, /^v\d+\.\d+\.\d+\.md$/, `${f}: name it v<version>.md, e.g. v1.2.3.md`);
    assert.deepEqual(notesProblems(readFileSync(new URL(f, dir), 'utf8')), [], f);
  }
});
