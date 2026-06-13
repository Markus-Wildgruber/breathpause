#!/usr/bin/env node
// Sync the release version across the three manifests from a single source of
// truth (the git tag). Run by .github/workflows/release.yml before building so
// package.json, tauri.conf.json and Cargo.toml always match the tag.
//
// Usage: node scripts/set-version.mjs 1.2.3
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`Invalid version: "${version}". Expected e.g. 1.2.3`);
  process.exit(1);
}

const edits = [
  // JSON manifests: the first top-level "version" field.
  { file: 'app/package.json', find: /("version":\s*")[^"]*(")/, repl: `$1${version}$2` },
  { file: 'app/src-tauri/tauri.conf.json', find: /("version":\s*")[^"]*(")/, repl: `$1${version}$2` },
  // Cargo.toml: the [package] version line (anchored, so rust-version is untouched).
  { file: 'app/src-tauri/Cargo.toml', find: /^version = "[^"]*"/m, repl: `version = "${version}"` },
];

for (const { file, find, repl } of edits) {
  const before = readFileSync(file, 'utf8');
  // Fail only if the field is genuinely missing — an already-correct version
  // (a no-op replacement) is fine and must not break the release.
  if (!find.test(before)) {
    console.error(`No version field found in ${file}`);
    process.exit(1);
  }
  const after = before.replace(find, repl);
  if (after !== before) writeFileSync(file, after);
  console.log(`${file} -> ${version}${after === before ? ' (already current)' : ''}`);
}
