import { expect, test } from '@playwright/test';

const DEMO = 'http://demo.thedaily.test:3123/';

test('the hosted demo lets visitors write immediately', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(DEMO);
  await page.waitForFunction(() => !!(window as any).__dailyEntries);
  await expect(page.locator('#introBack')).toHaveCount(0);
  await expect(page.locator('.demo-note')).toContainText('Notes are saved in this browser only');
  await expect(page.locator('#entry')).toBeFocused();
  await page.keyboard.type('Trying the demo.');
  await page.waitForTimeout(700);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__dailyEntries);
  expect(await page.evaluate(() => (window as any).allEntries().map((e: any) => e.text))).toContain('Trying the demo.');
  await page.locator('.demo-note [data-a="close"]').click();
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__dailyEntries);
  await expect(page.locator('.demo-note')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('running locally still shows the introduction to new users', async ({ page }) => {
  await page.goto('http://127.0.0.1:3123/');
  await expect(page.locator('#introBack')).toBeVisible();
  await expect(page.locator('.demo-note')).toHaveCount(0);
});
