import { test, expect } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';

// A minimal animated skin folder, zipped in-memory: one breath binding on #body.
function makeSkinZip({ name = 'Zip Bear', binding } = {}) {
  const manifest = {
    name,
    svg: 'skin.svg',
    themeColor: '#C38155',
    bindings: [
      binding ?? { target: 'body', property: 'scale', source: 'breath', from: 1, to: 1.1, origin: [50, 50] },
    ],
  };
  const svg = '<svg viewBox="0 0 100 100"><g id="body"><circle cx="50" cy="50" r="40" fill="#C38155"/></g></svg>';
  const bytes = zipSync({
    'skin.json': strToU8(JSON.stringify(manifest)),
    'skin.svg': strToU8(svg),
  });
  return Buffer.from(bytes);
}

async function openSkinsPane(page) {
  await page.goto('/settings.html');
  await page.locator('.rail .navitem', { hasText: 'Skins' }).click();
}

test('importing a zipped skin folder adds it to the gallery with its bindings', async ({ page }) => {
  await openSkinsPane(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'zip-bear.zip',
    mimeType: 'application/zip',
    buffer: makeSkinZip(),
  });

  // tile appears (custom names render as an editable input), preview mounts the SVG
  const name = page.locator('input.gname-edit');
  await expect(name).toHaveCount(1);
  await expect(name).toHaveValue('Zip Bear');
  const tile = page.locator('.skin-gitem', { has: name });
  await expect(tile.locator('.skin-preview svg')).toBeVisible();
  await expect(page.locator('.import-error')).toHaveCount(0);

  // Save persists the bindings into settings
  await page.getByRole('button', { name: 'Save' }).click();
  const stored = JSON.parse(
    await page.evaluate(() => localStorage.getItem('breathpause.settings')),
  );
  const skin = stored.customSkins.find((cs) => cs.name === 'Zip Bear');
  expect(skin).toBeTruthy();
  expect(skin.bindings).toHaveLength(1);
  expect(skin.bindings[0]).toMatchObject({ target: 'body', property: 'scale', source: 'breath' });
});

test('a zip with a broken binding is rejected with a visible error', async ({ page }) => {
  await openSkinsPane(page);
  const before = await page.locator('.skin-gitem').count();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'broken.zip',
    mimeType: 'application/zip',
    buffer: makeSkinZip({
      name: 'Broken',
      binding: { target: 'ghost', property: 'scale', source: 'breath', from: 1, to: 1.1 },
    }),
  });

  await expect(page.locator('.import-error')).toContainText('not found in the SVG');
  await expect(page.locator('.skin-gitem')).toHaveCount(before);
});

test('a bare SVG still imports as a recolor-only skin', async ({ page }) => {
  await openSkinsPane(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'plain-cat.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#4a90c8"/></svg>'),
  });
  await expect(page.locator('input.gname-edit')).toHaveValue('plain-cat');
  await expect(page.locator('.import-error')).toHaveCount(0);
});
