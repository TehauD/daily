import { test } from '@playwright/test';
import { control, noSeriousA11y, openApp } from './helpers';

test.beforeEach(async () => { await control('/reset'); });

test('main view', async ({ context }) => {
  const page = await openApp(context);
  await noSeriousA11y(page);
});

test('introduction', async ({ page }) => {
  await page.goto('/');
  await page.locator('#introBack').waitFor();
  await noSeriousA11y(page, '#introBack');
});

test('Studio', async ({ context }) => {
  const page = await openApp(context);
  for (const s of ['general', 'models', 'data']) {
    await page.evaluate(x => (window as any).openStudioHome(x), s);
    await noSeriousA11y(page, '#studioModal');
  }
});
