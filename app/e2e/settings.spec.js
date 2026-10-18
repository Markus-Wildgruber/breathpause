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

test('Behavior: the bubble dialog choices can be changed back and are saved', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('breathpause.settings',
    JSON.stringify({ behavior: { hideNoticeOff: true, editAutoSave: true } })));
  await page.goto('/settings.html');
  await page.locator('.rail .navitem', { hasText: 'Behavior' }).click();
  const remind = page.getByRole('checkbox', { name: /keeps running in the tray/ });
  const autosave = page.getByRole('checkbox', { name: /Save changes without asking/ });
  await expect(remind).not.toBeChecked();      // "Don't show again" was chosen
  await expect(autosave).toBeChecked();        // "Always save" was chosen
  await remind.check();
  await autosave.uncheck();
  await page.getByRole('button', { name: 'Save' }).click();
  const b = await page.evaluate(() => JSON.parse(localStorage.getItem('breathpause.settings')).behavior);
  expect(b.hideNoticeOff).toBe(false);
  expect(b.editAutoSave).toBe(false);
});

test('Behavior: breathing music offers every sound and hold style, previews, and saves', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/settings.html');
  await page.locator('.rail .navitem', { hasText: 'Behavior' }).click();
  const sound = page.getByLabel('Sound', { exact: true }), hold = page.getByLabel('Hold style');
  await expect(sound.locator('option')).toHaveCount(7);
  await expect(hold.locator('option')).toHaveCount(5);
  await hold.selectOption('countdown');
  await expect(page.getByText('Quiet, then three soft ticks into the next phase.')).toBeVisible();

  const listen = page.getByRole('button', { name: 'Listen' });
  await listen.click();
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveAttribute('aria-pressed', 'true');
  await sound.selectOption('kalimba');                      // switching while previewing restarts it
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Stop' }).click();

  await page.getByRole('checkbox', { name: /Play breathing music/ }).check();
  await page.getByLabel('Volume').fill('30');
  await page.getByRole('button', { name: 'Save' }).click();
  const m = await page.evaluate(() => JSON.parse(localStorage.getItem('breathpause.settings')).music);
  expect(m).toMatchObject({ on: true, sound: 'kalimba', hold: 'countdown', volume: 0.3 });
  expect(errors).toEqual([]);
});
