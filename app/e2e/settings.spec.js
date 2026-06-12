import { test, expect } from '@playwright/test';
import { trackErrors } from './_helpers.js';

test('every nav pane renders with no uncaught errors', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/settings.html');
  const items = page.locator('.rail .navitem');
  await expect(items).toHaveCount(6);

  for (const label of ['Patterns', 'Timers', 'Skins', 'Behavior', 'About', 'Appearance']) {
    const item = items.filter({ hasText: label });
    await item.click();
    await expect(item).toHaveClass(/sel/);
    await expect(page.locator('.pane')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('theme toggle flips the data-theme attribute', async ({ page }) => {
  await page.goto('/settings.html');
  const win = page.locator('.win');
  await page.locator('.seg button[title="Dark"]').click();
  await expect(win).toHaveAttribute('data-theme', 'dark');
  await page.locator('.seg button[title="Light"]').click();
  await expect(win).toHaveAttribute('data-theme', 'light');
});

test('searchable font dropdown filters and selects', async ({ page }) => {
  await page.goto('/settings.html');
  // Appearance -> Text subtab exposes the font picker.
  await page.locator('.apsubseg button', { hasText: 'Text' }).click();

  await page.locator('.fontdd-btn').click();
  const options = page.locator('.fontdd-opt');
  const total = await options.count();
  expect(total).toBeGreaterThan(10);

  await page.locator('.fontdd-search').fill('Calibri');
  await expect(options).toHaveCount(1);
  await options.first().click();
  await expect(page.locator('.fontdd-cur')).toHaveText('Calibri');
});

test('Save persists settings to localStorage', async ({ page }) => {
  await page.goto('/settings.html');
  await page.locator('.rail .navitem', { hasText: 'Timers' }).click();

  // Work duration is a Stepper: type into its field and commit with Enter.
  const work = page.locator('.card.timers .row', { hasText: 'Work' }).locator('.sf-input');
  await work.fill('01:30');
  await work.press('Enter');
  await page.getByRole('button', { name: 'Save' }).click();

  const stored = await page.evaluate(() => localStorage.getItem('breathpause.settings'));
  expect(stored).not.toBeNull();
  const parsed = JSON.parse(stored);
  // 01:30 work (hh:mm) -> 1h30m -> 5400s
  expect(parsed.timers.workSeconds).toBe(5400);
});
