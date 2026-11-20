#!/usr/bin/env node
// Builds the GitHub Pages site from the published releases:
//   site/template.html -> _site/index.html     download buttons and a short "What's new"
//   site/releases.html -> _site/releases.html  the main changes in every version
// Run by .github/workflows/pages.yml on every published/edited release.
//
// Usage: GITHUB_TOKEN=... node scripts/build-site.mjs [outDir]
// (Locally: GITHUB_TOKEN=$(gh auth token) node scripts/build-site.mjs)
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, cpSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const REPO = process.env.GITHUB_REPOSITORY || 'Markus-Wildgruber/breathpause';
const RELEASES = `https://github.com/${REPO}/releases`;
const out = process.argv[2] || '_site';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const link = (cls, url, text, os) =>
  `<a class="${cls}"${os ? ` data-os="${os}"` : ''} href="${esc(url)}">${esc(text)}</a>`;

// Notes worth showing: GitHub's rendering (sanitized by GitHub) without the bare
// "Full Changelog: …" line it adds. Nothing left = no "What's new" section.
export function realNotes(html) {
  return (html || '').replace(/<p>\s*<strong>Full Changelog<\/strong>[\s\S]*?<\/p>/g, '').trim();
}

export function render(template, releases) {
  const latest = releases.find((r) => !r.draft && !r.prerelease);
  const asset = (re) => latest?.assets.find((a) => re.test(a.name));
  const setup = asset(/_x64-setup\.exe$/), dmg = asset(/\.dmg$/), portable = asset(/_x64-standalone\.exe$/);
  const version = latest ? latest.tag_name.replace(/^v/, '') : '';

  const hero = [
    setup && link('btn', setup.browser_download_url, 'Download for Windows', 'win'),
    dmg && link('btn', dmg.browser_download_url, 'Download for Mac', 'mac'),
  ].filter(Boolean).join('\n        ') || link('btn', RELEASES, 'See all downloads');

  const win = setup
    ? link('btn', setup.browser_download_url, 'Download installer') +
      (portable ? `<p class="small">Rather not install anything? Get the ${link('', portable.browser_download_url, 'no-install version')}; it runs on its own.</p>` : '')
    : link('btn alt', RELEASES, 'See downloads');
  const mac = dmg ? link('btn', dmg.browser_download_url, 'Download for Mac') : link('btn alt', RELEASES, 'See downloads');

  const notes = latest && realNotes(latest.body_html);
  const news = notes
    ? `<section id="news">
    <h2>What's new in ${esc(version)}</h2>
    <div class="news"><div class="notes">${notes}</div></div>
    <p class="small" style="margin-top:14px">${link('', 'releases.html', 'All release notes')}</p>
  </section>`
    : '';

  // Functions, not strings: a "$&" or "$'" in release notes must stay as written.
  return template
    .replace('{{DOWNLOADS}}', () => hero)
    .replace('{{VERSION}}', () => esc(version || '–'))
    .replace('{{WIN}}', () => win)
    .replace('{{MAC}}', () => mac)
    .replace('{{NEWS}}', () => news);
}

const date = (iso) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// The files people download (not the updater's .sig / .tar.gz / latest.json), with plain names.
const FILES = [
  [/_x64-setup\.exe$/, 'Windows installer'],
  [/_x64-standalone\.exe$/, 'Windows, no install'],
  [/\.dmg$/, 'Mac'],
];

// releases.html: every published version, newest first, with its main changes.
export function renderReleases(template, releases) {
  const published = releases.filter((r) => !r.draft && !r.prerelease);
  const list = published.map((r, i) => {
    const version = r.tag_name.replace(/^v/, '');
    const first = i === published.length - 1;
    const notes = realNotes(r.body_html) ||
      `<p>${first ? 'The first public release of BreathPause.' : 'Small fixes and improvements.'}</p>`;
    const files = FILES.flatMap(([re, label]) => {
      const a = r.assets.find((x) => re.test(x.name));
      return a ? [link('', a.browser_download_url, label)] : [];
    }).join('');
    return `<article class="release" id="v${esc(version)}">
    <div class="when"><h2>${esc(version)}</h2><time datetime="${esc(r.published_at)}">${date(r.published_at)}</time>${i === 0 ? '<br><span class="latest">Latest</span>' : ''}</div>
    <div><div class="notes">${notes}</div>${files ? `<div class="files">${files}</div>` : ''}</div>
  </article>`;
  }).join('\n  ');
  return template.replace('{{RELEASES}}', () => list || '<p class="sub">No releases yet.</p>');
}

async function main() {
  const headers = { Accept: 'application/vnd.github.html+json', 'User-Agent': 'breathpause-site' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const releases = await res.json();

  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/index.html`, render(readFileSync('site/template.html', 'utf8'), releases));
  writeFileSync(`${out}/releases.html`, renderReleases(readFileSync('site/releases.html', 'utf8'), releases));
  copyFileSync('site/style.css', `${out}/style.css`);
  copyFileSync('site/theme.js', `${out}/theme.js`);
  cpSync('site/img', `${out}/img`, { recursive: true });
  copyFileSync('app/public/img/favicon.ico', `${out}/favicon.ico`);
  copyFileSync('app/public/img/breathpause-64.png', `${out}/logo.png`);
  const latest = releases.find((r) => !r.draft && !r.prerelease);
  console.log(`${out}/: built from ${latest ? latest.tag_name : 'no release yet'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
