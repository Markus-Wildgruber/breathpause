// Screenshots for the website (site/img/*.png), taken from the real UI in a browser.
// Rerun after visible UI changes:   npm run dev   (port 5175), then
//                                    node tools/site-screenshots.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE || 'http://localhost:5175';
const OUT = fileURLToPath(new URL('../../site/img/', import.meta.url));
// Stands in for a desktop wallpaper behind the transparent bubble window.
const WALL = 'linear-gradient(135deg,#27405f,#4b3c63 55%,#6e4a63)';

const SHOTS = [
  { name: 'bubble', path: '/index.html', size: [420, 320], wall: true,
    ready: '.stage svg', wait: 2600 },
  { name: 'break', path: '/index.html', size: [960, 560], wall: true,
    settings: { timers: { workSeconds: 1, breakSeconds: 120 }, appearance: { break: { skin: 'sleepy-seal' } } },
    ready: 'main.breaking .stage svg', wait: 3200 },
  { name: 'settings-appearance', path: '/settings.html?pane=appearance', size: [760, 600],
    settings: { theme: 'dark' }, ready: '.card.preview .orb svg', wait: 1200 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const s of SHOTS) {
  const page = await browser.newPage({ viewport: { width: s.size[0], height: s.size[1] }, deviceScaleFactor: 2 });
  if (s.settings) {
    await page.addInitScript((v) => localStorage.setItem('breathpause.settings', JSON.stringify(v)), s.settings);
  }
  await page.goto(BASE + s.path);
  if (s.wall) await page.addStyleTag({ content: `html,body{background:${WALL} !important}` });
  await page.locator(s.ready).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(s.wait);   // let the bubble breathe to a nice size
  await page.screenshot({ path: `${OUT}${s.name}.png` });
  console.log(`site/img/${s.name}.png`);
  await page.close();
}
await browser.close();
