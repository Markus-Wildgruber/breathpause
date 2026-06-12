import { test, expect } from '@playwright/test';
import { trackErrors } from './_helpers.js';

test('renders all nav panes with no uncaught errors', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/settings.html');
  await expect(page.locator('.rail .navitem')).toHaveCount(6);
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
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
  await page.locator('#wt').fill('01:30');
  await page.getByRole('button', { name: 'Save' }).click();

  const stored = await page.evaluate(() => localStorage.getItem('breathpause.settings'));
  expect(stored).not.toBeNull();
  const parsed = JSON.parse(stored);
  // 01:30 work (hh:mm) -> 1h30m -> 5400s
  expect(parsed.timers.workSeconds).toBe(5400);
});
