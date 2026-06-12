import { test, expect } from '@playwright/test';

// Seed the draft the editor reads on mount (the localStorage bus between Settings and
// this window). Runs in the page before any app script.
function setDraft(data) {
  localStorage.setItem('breathpause.patternDraft', JSON.stringify(data));
}

const BOX = { id: 'box', name: 'Box', phases: [{ type: 'in', seconds: 4 }, { type: 'hold', seconds: 4 }] };

test('loads a draft and edits phases', async ({ page }) => {
  await page.addInitScript(setDraft, { pattern: BOX, isNew: false });
  await page.goto('/pattern-editor.html');

  await expect(page.getByRole('heading', { name: 'Edit pattern' })).toBeVisible();
  await expect(page.locator('.phase-row')).toHaveCount(2);

  await page.getByText('+ Add phase').click();
  await expect(page.locator('.phase-row')).toHaveCount(3);

  await page.locator('.phase-del').first().click();
  await expect(page.locator('.phase-row')).toHaveCount(2);
});

test('validates an empty name on save', async ({ page }) => {
  await page.addInitScript(setDraft, { pattern: { id: 'p1', name: '', phases: [{ type: 'in', seconds: 4 }] }, isNew: true });
  await page.goto('/pattern-editor.html');

  await expect(page.getByRole('heading', { name: 'New pattern' })).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.err')).toContainText('Name is required');
});

test('Save writes the result to localStorage', async ({ page }) => {
  await page.addInitScript(setDraft, { pattern: BOX, isNew: false });
  await page.goto('/pattern-editor.html');

  await page.getByRole('button', { name: 'Save' }).click();
  const result = await page.evaluate(() => localStorage.getItem('breathpause.patternResult'));
  const parsed = JSON.parse(result);
  expect(parsed.name).toBe('Box');
  expect(parsed.phases).toHaveLength(2);
});

test('Delete writes a tombstone to localStorage', async ({ page }) => {
  await page.addInitScript(setDraft, { pattern: BOX, isNew: false });
  await page.goto('/pattern-editor.html');

  await page.getByRole('button', { name: 'Delete' }).click();
  const result = await page.evaluate(() => localStorage.getItem('breathpause.patternResult'));
  expect(JSON.parse(result)).toEqual({ id: 'box', deleted: true });
});
