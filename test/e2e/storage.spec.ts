import { expect, test } from '@playwright/test';
import { control, openApp, ready, type } from './helpers';

test.beforeEach(async () => { await control('/reset'); });

test('moves a pre-2.0 journal from browser storage into the database', async ({ page }) => {
  await page.goto('/healthz');
  await page.evaluate(() => {
    localStorage.setItem('daily:introSeen', 'test');
    localStorage.setItem('daily:settings', JSON.stringify({ theme: 'dark' }));
    localStorage.setItem('daily:entry:v2:2026-09-01:old1', JSON.stringify({ id: 'old1', date: '2026-09-01', title: 'From 1.x', text: 'Written before 2.0', created: '2026-09-01T10:00:00Z' }));
  });
  await page.goto('/');
  await ready(page);
  const r = await page.evaluate(() => ({
    mode: (window as any).DailyStore.info.mode,
    titles: (window as any).allEntries().map((e: any) => e.title),
    leftInLocalStorage: Object.keys(localStorage).filter(k => k.startsWith('daily:entry')),
    theme: document.documentElement.dataset.theme,
  }));
  expect(r).toEqual({ mode: 'indexeddb', titles: ['From 1.x'], leftInLocalStorage: [], theme: 'dark' });
  await page.reload();
  await ready(page);
  expect(await page.evaluate(() => (window as any).allEntries().length)).toBe(1);
});

test('notes survive a reload and other tabs follow along', async ({ context }) => {
  const a = await openApp(context);
  await type(a, 'Tabs', 'Written in tab one.');
  const b = await context.newPage();
  await b.goto('/');
  await ready(b);
  expect(await b.evaluate(() => (window as any).allEntries().map((e: any) => e.text))).toContain('Written in tab one.');
  await a.evaluate(() => { const B = (window as any).__dailyEntries; const e = B.findById(B.current().id); B.save({ ...e, text: e.text + '\n\nAnd more.' }); });
  await expect.poll(() => b.evaluate(() => (window as any).allEntries().some((e: any) => e.text.includes('And more.')))).toBe(true);
  await a.reload();
  await ready(a);
  expect(await a.evaluate(() => (window as any).allEntries().some((e: any) => e.text.includes('And more.')))).toBe(true);
});
