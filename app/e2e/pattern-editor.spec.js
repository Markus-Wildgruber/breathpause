import { test, expect } from '@playwright/test';

// Seed the draft the editor reads on mount (the localStorage bus between Settings and
// this window). Runs in the page before any app script.
function setDraft(data) {
  localStorage.setItem('breathpause.patternDraft', JSON.stringify(data));
}

const BOX = { id: 'box', name: 'Box', phases: [{ type: 'in', seconds: 4 }, { type: 'hold', seconds: 4 }] };

test('loads a draft and edits phases', async ({ page }) => {
  await page.addInitScript(setDraft, { pattern: BOX, isNew: false, existingNames: [] });
  await page.goto('/pattern-editor.html');

  await expect(page.locator('.title-input')).toHaveValue('Box');
  await expect(page.locator('.phase-row')).toHaveCount(2);

  await page.getByText('+ Add phase').click();
  await expect(page.locator('.phase-row')).toHaveCount(3);

  await page.locator('.phase-del').first().click();
  await expect(page.locator('.phase-row')).toHaveCount(2);
});

test('an empty name disables Save', async ({ page }) => {
  await page.addInitScript(setDraft, {
    pattern: { id: 'p1', name: '', phases: [{ type: 'in', seconds: 4 }] },
    isNew: true,
    existingNames: [],
  });
  await page.goto('/pattern-editor.html');
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await page.locator('.title-input').fill('My pattern');
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
});

test('a duplicate name is flagged', async ({ page }) => {
  await page.addInitScript(setDraft, {
    pattern: { id: 'p1', name: 'Fresh', phases: [{ type: 'in', seconds: 4 }] },
    isNew: true,
    existingNames: ['Coherent'],
  });
  await page.goto('/pattern-editor.html');
  await page.locator('.title-input').fill('Coherent');
  await expect(page.locator('.err')).toContainText('already exists');
});

test('Save writes the pattern into settings', async ({ page }) => {
  await page.addInitScript(setDraft, {
    pattern: { id: 'p-new', name: 'My Box', phases: BOX.phases },
    isNew: true,
    existingNames: [],
  });
  await page.goto('/pattern-editor.html');

  await page.getByRole('button', { name: 'Save' }).click();
  const stored = JSON.parse(
    await page.evaluate(() => localStorage.getItem('breathpause.settings')),
  );
  const saved = stored.patterns.find((p) => p.id === 'p-new');
  expect(saved).toBeTruthy();
  expect(saved.name).toBe('My Box');
  expect(saved.phases).toHaveLength(2);
});

test('Delete removes the pattern from settings', async ({ page }) => {
  // 'box' is one of the default patterns, so deleting it must drop it from the list.
  await page.addInitScript(setDraft, { pattern: BOX, isNew: false, existingNames: [] });
  await page.goto('/pattern-editor.html');

  await page.getByRole('button', { name: 'Delete' }).click();
  const stored = JSON.parse(
    await page.evaluate(() => localStorage.getItem('breathpause.settings')),
  );
  expect(stored.patterns.some((p) => p.id === 'box')).toBe(false);
  expect(stored.patterns.length).toBeGreaterThan(0);
});
