import { expect, type BrowserContext, type Page } from '@playwright/test';

export const CONTROL = 'http://127.0.0.1:8766';

export async function control<T = any>(path: string): Promise<T> {
  const r = await fetch(CONTROL + path);
  return r.json() as Promise<T>;
}

/** A page on the relay with the first-run introduction already seen. */
export async function openApp(context: BrowserContext, url = '/'): Promise<Page> {
  await context.addInitScript(() => { try { localStorage.setItem('daily:introSeen', 'test'); } catch { /* ignore */ } });
  const page = await context.newPage();
  page.on('pageerror', e => { throw e; });
  await page.goto(url);
  await ready(page);
  return page;
}

export async function ready(page: Page) {
  await page.waitForFunction(() => !!(window as any).__dailyEntries && document.querySelectorAll('script[type="text/x-daily-module"]').length === 0);
}

export async function type(page: Page, title: string, body: string) {
  await page.locator('#entry').click();
  await page.keyboard.type(body);
  await page.locator('#entryTitle').fill(title);
  await page.waitForTimeout(700); // autosave
}

export const current = (page: Page) => page.evaluate(() => {
  const b = (window as any).__dailyEntries; const c = b.current(); return b.findById(c.id);
});

export async function noSeriousA11y(page: Page, include?: string) {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  let axe = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include) axe = axe.include(include);
  const r = await axe.analyze();
  const bad = r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map(v => `${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target}`)).toEqual([]);
}
