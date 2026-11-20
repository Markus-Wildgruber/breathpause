#!/usr/bin/env node
// Checks that a version is ready to release, then (with --push) creates and pushes its tag,
// which starts .github/workflows/release.yml.
//
//   npm run release -- 0.2.0          check only
//   npm run release -- 0.2.0 --push   check, then tag v0.2.0 and push it
//
// Ready means: release-notes/v<version>.md exists with real notes (the website's release page
// shows them), the version is newer than every existing tag and not taken yet, and main is
// committed and up to date with GitHub.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Compare "1.2.3" versions: <0, 0, >0.
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

// The problems with a release-notes file's text ([] = fine).
export function notesProblems(text) {
  if (text == null) return ['missing'];
  if (!/^\s*[-*]\s+\S/m.test(text)) return ['has no bullet points (- …) describing changes'];
  return [];
}

// Everything that stops `version` from being released ([] = ready).
export function releaseProblems({ version, notes, tags, branch, dirty, behind }) {
  const tag = `v${version}`, problems = [];
  if (!/^\d+\.\d+\.\d+$/.test(version)) return [`"${version}" is not a version like 1.2.3`];
  for (const p of notesProblems(notes)) problems.push(`release-notes/${tag}.md ${p}`);
  if (tags.includes(tag)) problems.push(`tag ${tag} already exists`);
  const newest = tags.map((t) => t.replace(/^v/, '')).filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .sort(compareVersions).pop();
  if (newest && compareVersions(version, newest) <= 0) problems.push(`${version} is not newer than the latest tag v${newest}`);
  if (branch !== 'main') problems.push(`you are on "${branch}", not main`);
  if (dirty) problems.push('there are uncommitted changes');
  if (behind) problems.push('main is not up to date with GitHub (pull first)');
  return problems;
}

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

function main() {
  const version = process.argv[2] || '';
  const push = process.argv.includes('--push');
  const tag = `v${version}`;
  const notesPath = `${ROOT}/release-notes/${tag}.md`;

  git('fetch', '--quiet', '--tags', 'origin', 'main');
  const remoteTags = git('ls-remote', '--tags', 'origin').split('\n').map((l) => l.split('refs/tags/')[1]).filter(Boolean);
  const problems = releaseProblems({
    version,
    notes: existsSync(notesPath) ? readFileSync(notesPath, 'utf8') : null,
    tags: [...new Set([...git('tag').split('\n').filter(Boolean), ...remoteTags.map((t) => t.replace(/\^\{\}$/, ''))])],
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    dirty: git('status', '--porcelain') !== '',
    behind: git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main'),
  });

  if (problems.length) {
    console.error(`Not ready to release ${tag}:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  if (!push) {
    console.log(`${tag} is ready. Run again with --push to tag and release it.`);
    return;
  }
  git('tag', '-a', tag, '-m', `BreathPause ${version}`);
  git('push', 'origin', tag);
  console.log(`Pushed ${tag}. The release builds now; publish the draft when it's done:\nhttps://github.com/Markus-Wildgruber/breathpause/releases`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
