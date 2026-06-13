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
  // JSON manifests: replace the first top-level "version" field.
  { file: 'app/package.json', update: (s) => s.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`) },
  { file: 'app/src-tauri/tauri.conf.json', update: (s) => s.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`) },
  // Cargo.toml: the [package] version line (anchored, so rust-version is untouched).
  { file: 'app/src-tauri/Cargo.toml', update: (s) => s.replace(/^version = "[^"]*"/m, `version = "${version}"`) },
];

for (const { file, update } of edits) {
  const before = readFileSync(file, 'utf8');
  const after = update(before);
  if (after === before) {
    console.error(`No version field updated in ${file}`);
    process.exit(1);
  }
  writeFileSync(file, after);
  console.log(`${file} -> ${version}`);
}
