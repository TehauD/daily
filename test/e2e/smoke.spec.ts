import { expect, test } from '@playwright/test';
import { control, openApp } from './helpers';

test.beforeEach(async () => { await control('/reset'); });

test('every feature module starts without errors', async ({ context }) => {
  const errors: string[] = [];
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__dailyEntries);
  await page.waitForTimeout(1200);
  expect(errors).toEqual([]);
  expect(await page.locator('script[type="text/x-daily-module"]').count()).toBe(0);
  for (const id of ['app', 'multi-file-storage-release', 'provider-switch', 'workitems-module', 'refine-shell', 'ai-studio']) {
    await expect(page.locator(`script#${id}`)).toHaveCount(1);
  }
});

test('Studio sections all open', async ({ context }) => {
  const page = await openApp(context);
  await page.evaluate(() => (window as any).openStudioHome('general'));
  for (const s of ['general', 'appearance', 'workspace', 'models', 'intelligence', 'knowledge', 'integrations', 'data', 'advanced', 'about']) {
    await page.locator(`#studioModal .studio-nav[data-s="${s}"]`).click();
    await expect(page.locator(`#studioModal .studio-section[data-s="${s}"]`)).toBeVisible();
  }
  await page.locator('#studioModal .studio-nav[data-s="data"]').click();
  await expect(page.locator('.core-storage')).toContainText('Journal folder');
});
