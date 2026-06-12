import { test, expect } from '@playwright/test';
import { trackErrors } from './_helpers.js';

test('bubble mounts the orb skin SVG and runs without errors', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');

  // showMode() fetches and mounts the default skin into .stage.
  await expect(page.locator('.stage svg')).toBeVisible();
  // Phase label line renders (text comes from the running breathing loop).
  await expect(page.locator('.textblock .label')).toBeVisible();

  expect(errors).toEqual([]);
});
