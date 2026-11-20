import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, realNotes, renderReleases } from '../../scripts/build-site.mjs';

const T = '{{DOWNLOADS}}|{{VERSION}}|{{WIN}}|{{MAC}}|{{NEWS}}';
const asset = (name) => ({ name, browser_download_url: `https://example.test/${name}` });
const rel = (tag, extra = {}) => ({
  tag_name: tag, draft: false, prerelease: false, html_url: `https://example.test/tag/${tag}`,
  body_html: `<h2>Highlights</h2><ul><li>New in ${tag}</li></ul>`,
  assets: [asset(`breathpause_${tag}_x64-setup.exe`), asset(`breathpause_${tag}_x64-setup.exe.sig`),
           asset(`breathpause_${tag}_x64-standalone.exe`), asset('latest.json')],
  ...extra,
});
const parts = (html) => html.split('|');

test('site: the newest published release drives downloads and "What\'s new"; drafts and pre-releases are skipped', () => {
  const [hero, version, win, mac, news] = parts(render(T, [
    rel('v0.3.0', { draft: true }), rel('v0.2.1', { prerelease: true }), rel('v0.2.0'), rel('v0.1.0')]));
  assert.equal(version, '0.2.0');
  assert.match(hero, /data-os="win".*v0\.2\.0_x64-setup\.exe/);
  assert.doesNotMatch(hero, /data-os="mac"/);                    // no .dmg: no Mac button
  assert.match(win, /v0\.2\.0_x64-setup\.exe/);
  assert.match(win, /no-install version/);
  assert.match(mac, /See downloads/);                            // falls back to the releases page
  assert.match(news, /What's new in 0\.2\.0.*New in v0\.2\.0/s);
  assert.doesNotMatch(news, /v0\.1\.0|0\.3\.0|0\.2\.1/);         // only the newest notes
});

test('site: a release whose notes are only the "Full Changelog" link gets no "What\'s new"', () => {
  const bare = '<p><strong>Full Changelog</strong>: <a href="https://x/commits/v0.1.0">https://x/commits/v0.1.0</a></p>';
  assert.equal(realNotes(bare), '');
  assert.equal(parts(render(T, [rel('v0.1.0', { body_html: bare })]))[4], '');
  assert.match(realNotes(`<ul><li>Real</li></ul>\n${bare}`), /^<ul><li>Real<\/li><\/ul>$/);
});

test('site: no releases yet still renders; asset names are escaped', () => {
  assert.match(render(T, []), /See all downloads/);
  const hero = parts(render(T, [rel('v1.0.0', { assets: [asset('a"b_x64-setup.exe')] })]))[0];
  assert.match(hero, /a&#34;b_x64-setup\.exe/);
});

test('releases page: every published version newest first, with its notes and only the files people download', () => {
  const bare = '<p><strong>Full Changelog</strong>: <a href="x">x</a></p>';
  const html = renderReleases('{{RELEASES}}', [
    rel('v0.3.0', { draft: true }), rel('v0.2.0'),
    rel('v0.1.1', { body_html: bare }), rel('v0.1.0', { body_html: bare, published_at: '2026-06-16T05:36:09Z' })]);
  assert.doesNotMatch(html, /0\.3\.0/);
  assert.ok(html.indexOf('id="v0.2.0"') < html.indexOf('id="v0.1.0"'));
  assert.match(html, /id="v0\.2\.0".*Latest.*New in v0\.2\.0/s);
  assert.match(html, /id="v0\.1\.1".*Small fixes and improvements/s);   // no real notes
  assert.match(html, /id="v0\.1\.0".*16 June 2026.*first public release/s);
  assert.match(html, />Windows installer<.*>Windows, no install</s);
  assert.doesNotMatch(html, /\.sig|latest\.json/);
});

test('site: "$" patterns in release notes stay as written', () => {
  const notes = '<p>Run <code>echo $&amp; $\' $` $$</code></p>';
  const raw = "<p>a $& b $' c $` d $$</p>";
  const news = parts(render(T, [rel('v1.0.0', { body_html: raw })]))[4];
  assert.ok(news.includes(raw), news);
  assert.ok(renderReleases('{{RELEASES}}', [rel('v1.0.0', { body_html: notes })]).includes(notes));
});
