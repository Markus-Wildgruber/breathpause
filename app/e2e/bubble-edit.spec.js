import { test, expect } from '@playwright/test';
import { trackErrors } from './_helpers.js';

// Bubble edit mode. In a plain browser there's no hover poller, so "hovered" is simulated
// by setting body.hot the way interactivity.js does.
async function hover(page, settings) {
  if (settings) {
    await page.addInitScript((s) => localStorage.setItem('breathpause.settings', JSON.stringify(s)), settings);
  }
  await page.goto('/index.html');
  await expect(page.locator('.stage svg')).toBeVisible();
  await page.evaluate(() => document.body.classList.add('hot'));
}

async function edit(page, settings) {
  await hover(page, settings);
  await page.getByRole('button', { name: 'Edit' }).click();
}

const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

test('hover buttons show a pointer cursor; only the bubble shows move', async ({ page }) => {
  await hover(page);
  const btn = page.getByRole('button', { name: 'Edit' });
  await expect(btn).toBeVisible();
  expect(await btn.evaluate((el) => getComputedStyle(el).cursor)).toBe('pointer');
  // The icon covers most of the button, so it must not inherit the bubble's move cursor.
  expect(await btn.locator('svg').evaluate((el) => getComputedStyle(el).cursor)).not.toBe('move');
  // The bubble and its text both move the window outside edit mode.
  expect(await page.locator('.textblock .label').evaluate((el) => getComputedStyle(el).cursor)).toBe('move');
  expect(await page.locator('.textblock .pomo').evaluate((el) => getComputedStyle(el).cursor)).toBe('move');
  expect(await page.locator('.stage').evaluate((el) => getComputedStyle(el).cursor)).toBe('move');
});

test('edit mode: the bubble is not draggable, it is selectable', async ({ page }) => {
  await edit(page);
  expect(await page.locator('.stage').evaluate((el) => getComputedStyle(el).cursor)).toBe('pointer');
  await page.locator('.stage').click();
  const range = page.getByRole('slider', { name: 'Bubble size' });
  await range.fill('300');
  await expect(page.locator('.stage')).toHaveCSS('width', '300px');
  await page.getByRole('slider', { name: 'Bubble opacity' }).fill('40');
  await expect(page.locator('.stage')).toHaveCSS('opacity', '0.4');
  // Size and opacity sit side by side, both inside the fixed-width side panel.
  const side = await page.locator('.side').boundingBox();
  const [size, opacity] = await Promise.all(
    (await page.locator('.side .vrange').all()).map((r) => r.boundingBox()));
  expect(Math.abs(size.y - opacity.y)).toBeLessThan(2);
  expect(opacity.x).toBeGreaterThan(size.x + size.width - 1);
  for (const b of [size, opacity]) {
    expect(b.x).toBeGreaterThanOrEqual(side.x);
    expect(b.x + b.width).toBeLessThanOrEqual(side.x + side.width);
  }
  await page.getByRole('button', { name: 'Bubble color' }).click();
  await page.getByRole('button', { name: '#EF476F' }).click();
  // The skin is re-mounted recolored (hue-shifted from its anchor, so just "changed").
  await expect(page.locator('.preset.on')).toHaveAttribute('title', '#EF476F');
});

test('edit mode: select a line, change its size and color', async ({ page }) => {
  const errors = trackErrors(page);
  await edit(page);
  await page.locator('.textblock .label').click();

  // Size rail: clicking the track (not just dragging the thumb) changes the size.
  const range = page.getByRole('slider', { name: 'Text size' });
  await expect(range).toBeVisible();
  const before = await page.locator('.textblock .label').evaluate((el) => el.style.fontSize);
  const box = await range.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(20);                // a 6px rail was unhittable in the app
  await page.mouse.click(box.x + 2, box.y + 4);                // off-center, near the top = larger
  const after = await page.locator('.textblock .label').evaluate((el) => el.style.fontSize);
  expect(after).not.toBe(before);

  // Color: preset, then hex entry.
  await page.getByRole('button', { name: 'Text color' }).click();
  await page.getByRole('button', { name: '#EF476F' }).click();
  await expect(page.locator('.textblock .label')).toHaveCSS('color', 'rgb(239, 71, 111)');
  await page.getByRole('textbox', { name: 'Hex color' }).fill('#0a0');
  await expect(page.locator('.textblock .label')).toHaveCSS('color', 'rgb(0, 170, 0)');

  // Custom picker: the first tile of the color grid is a native color input.
  const custom = page.locator('.presets > :first-child input[type=color]');
  await expect(custom).toHaveAttribute('aria-label', 'Custom color');
  await custom.fill('#123456');
  await expect(page.locator('.textblock .label')).toHaveCSS('color', 'rgb(18, 52, 86)');

  expect(errors).toEqual([]);
});

test('edit mode: the color panel for the timer line stays fully on screen', async ({ page }) => {
  await edit(page);
  await page.locator('.textblock .pomo').click();
  await page.getByRole('button', { name: 'Text color' }).click();
  const panel = await page.locator('.color-panel').boundingBox();
  const vw = await page.evaluate(() => innerWidth);
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(vw);
});

test('edit mode: a small bubble scaled up (unsaved) keeps its controls on screen', async ({ page }) => {
  await edit(page, { appearance: { work: { sizePx: 80 } } });
  await page.locator('.stage').click();
  const range = page.getByRole('slider', { name: 'Bubble size' });
  await range.fill(await range.getAttribute('max'));
  await page.getByRole('button', { name: 'Bubble color' }).click();
  const vw = await page.evaluate(() => innerWidth);
  for (const sel of ['.stage', '.side', '.color-panel']) {
    const b = await page.locator(sel).boundingBox();
    expect(b.x, sel).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, sel).toBeLessThanOrEqual(vw);
  }
});

test('edit mode: show/hide the two parts of the selected line', async ({ page }) => {
  await edit(page);
  const line = page.locator('.textblock .label');
  await line.click();
  await expect(line).toHaveText(/\d/);                       // countdown shown by default
  await page.getByRole('checkbox', { name: 'Count' }).uncheck();
  await expect(line).not.toHaveText(/\d/);
  await page.getByRole('checkbox', { name: 'Phase' }).uncheck();
  await expect(line).toHaveText('Text');                     // placeholder keeps it grabbable
  await page.getByRole('checkbox', { name: 'Count' }).check();
  await expect(line).toHaveText(/^\d+$/);
});

test('edit mode: dragging a line near the skin center docks onto it', async ({ page }) => {
  await edit(page);
  const line = page.locator('.textblock .label');
  const stage = center(await page.locator('.stage').boundingBox());
  const start = center(await line.boundingBox());
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Aim 4px off the skin's center: close enough to dock.
  await page.mouse.move(stage.x + 4, stage.y - 3, { steps: 8 });
  await page.mouse.up();
  const end = center(await line.boundingBox());
  expect(Math.abs(end.x - stage.x)).toBeLessThan(1);
  expect(Math.abs(end.y - stage.y)).toBeLessThan(1);
});

test('edit UI follows the light theme from settings', async ({ page }) => {
  await edit(page, { theme: 'light' });
  await expect(page.locator('.bb').first()).toHaveCSS('color', 'rgb(26, 26, 31)');
});

test('edit mode: ✕ (and Esc) close without a question when nothing changed', async ({ page }) => {
  await edit(page);
  await page.getByRole('button', { name: 'Close edit mode' }).click();
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
  await expect(page.locator('.confirm')).toHaveCount(0);
});

test('edit mode: ✕ with changes asks; Discard restores, Save keeps', async ({ page }) => {
  await edit(page);
  const line = page.locator('.textblock .label');
  const before = await line.evaluate((el) => el.style.fontSize);
  await line.click();
  await page.getByRole('slider', { name: 'Text size' }).fill('30');
  await page.getByRole('button', { name: 'Close edit mode' }).click();
  await expect(page.getByText('Save your text changes?')).toBeVisible();
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(line).toHaveCSS('font-size', before);

  // Same again via Esc, this time saving.
  await page.getByRole('button', { name: 'Edit' }).click();
  await line.click();
  await page.getByRole('slider', { name: 'Text size' }).fill('30');
  await page.locator('.stage').click();          // deselect so Esc goes straight to closing
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(line).toHaveCSS('font-size', '30px');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('breathpause.settings')).appearance.work.labelSize);
  expect(stored).toBe(30);
});

test('edit mode: with "save on close" set, ✕ saves without asking', async ({ page }) => {
  await edit(page, { behavior: { editAutoSave: true } });
  await page.locator('.textblock .label').click();
  await page.getByRole('slider', { name: 'Text size' }).fill('28');
  await page.getByRole('button', { name: 'Close edit mode' }).click();
  await expect(page.locator('.confirm')).toHaveCount(0);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('breathpause.settings')).appearance.work.labelSize);
  expect(stored).toBe(28);
});

test('edit mode: the skin strip switches skins; Discard brings the old one back', async ({ page }) => {
  await edit(page);
  await page.locator('.stage').click();
  const strip = page.getByRole('group', { name: 'Skins' });
  await expect(strip.getByRole('button', { name: 'Classic Orb' })).toHaveAttribute('aria-pressed', 'true');
  await expect(strip.locator('.sk svg')).toHaveCount(4);           // thumbnails rendered
  await expect(strip.locator('[aria-label="More skins"]')).toBeDisabled();   // 4 fit, no scrolling

  await strip.getByRole('button', { name: 'Cute Bear' }).click();
  await expect(page.locator('.stage [id$="-face"]')).toHaveCount(1);  // the bear's drawn face
  await page.getByRole('button', { name: 'Close edit mode' }).click();
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.locator('.stage [id$="-face"]')).toHaveCount(0);  // back to the orb

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.locator('.stage').click();
  await page.getByRole('group', { name: 'Skins' }).getByRole('button', { name: 'Sweet Jelly' }).click();
  await page.getByRole('button', { name: 'Save and close' }).click();
  const skin = await page.evaluate(() => JSON.parse(localStorage.getItem('breathpause.settings')).appearance.work.skin);
  expect(skin).toBe('sweet-jelly');
});

test('edit mode: with more skins than fit, the strip scrolls with the arrows', async ({ page }) => {
  const customSkins = [1, 2, 3, 4].map((i) => ({
    id: `custom-${i}`, name: `Mine ${i}`, svgText: `<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="${i}"/></svg>`,
  }));
  await edit(page, { customSkins });
  await page.locator('.stage').click();
  const strip = page.getByRole('group', { name: 'Skins' });
  await expect(strip.locator('.sk')).toHaveCount(8);
  const more = strip.locator('[aria-label="More skins"]');
  await expect(more).toBeEnabled();
  await expect(strip.locator('[aria-label="Previous skins"]')).toBeDisabled();
  await more.click();
  await expect(strip.locator('[aria-label="Previous skins"]')).toBeEnabled();
  expect(await strip.locator('.sk-row').evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
});

test('music button: bottom right of the bubble on hover, toggles and remembers music', async ({ page }) => {
  const errors = trackErrors(page);
  await hover(page);
  const btn = page.getByRole('button', { name: 'Play breathing music' });
  await expect(btn).toBeVisible();
  const b = await btn.boundingBox(), s = await page.locator('.stage').boundingBox();
  expect(b.x + b.width).toBeGreaterThan(s.x + s.width - 40);     // right edge of the bubble
  expect(b.y + b.height).toBeGreaterThan(s.y + s.height - 40);   // bottom of the bubble
  await btn.click();
  const mute = page.getByRole('button', { name: 'Mute breathing music' });
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('breathpause.settings')).music.on);
  expect(await stored()).toBe(true);
  await page.waitForTimeout(1500);                                 // let it play a moment
  await mute.click();
  await expect(page.getByRole('button', { name: 'Play breathing music' })).toHaveAttribute('aria-pressed', 'false');
  expect(await stored()).toBe(false);
  expect(errors).toEqual([]);
});

test('music button: always visible on the break screen', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('breathpause.settings',
    JSON.stringify({ timers: { workSeconds: 1, breakSeconds: 60 } })));
  await page.goto('/index.html');
  await expect(page.locator('main.breaking')).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Play breathing music' })).toBeVisible();   // no hover needed
});

test('edit mode: a break starting mid-edit drops the unsaved edits instead of saving them', async ({ page }) => {
  await edit(page, { timers: { workSeconds: 4, breakSeconds: 60 } });
  await page.locator('.stage').click();
  await page.getByRole('slider', { name: 'Bubble size' }).fill('300');
  await expect(page.locator('main.breaking')).toBeVisible({ timeout: 8000 });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('breathpause.settings')).appearance?.work?.sizePx);
  expect(stored ?? 200).toBe(200);                              // never written
  expect(await page.locator('.stage').evaluate((el) => el.style.width)).not.toBe('300px');
});

test('music button saves only the music setting, never other (stale or unsaved) values', async ({ page }) => {
  await hover(page, { appearance: { work: { sizePx: 250 } } });
  // Meanwhile the settings window saved a new size; this bubble still holds 250 in memory.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('breathpause.settings'));
    s.appearance.work.sizePx = 260;
    localStorage.setItem('breathpause.settings', JSON.stringify(s));
  });
  await page.getByRole('button', { name: 'Play breathing music' }).click();
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('breathpause.settings')));
  expect(s.music.on).toBe(true);
  expect(s.appearance.work.sizePx).toBe(260);                    // not overwritten with 250
});
