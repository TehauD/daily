import { expect, test, type Page } from '@playwright/test';
import { control, current, openApp, type } from './helpers';

test.beforeEach(async () => { await control('/reset'); });

const remote = async () => (await control('/remote')).files as Record<string, string>;
const edit = (path: string, a: string, b: string) => control(`/remote?op=replace&path=${encodeURIComponent(path)}&a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
const setText = (page: Page, fn: string) => page.evaluate(f => { const w = window as any; w.setEntryText(new Function('t', 'return ' + f)(w.collect().text)); w.flush(); }, fn);

async function pushed(page: Page) {
  await page.evaluate(() => (window as any).pushRepos());
  await expect(page.locator('#toast')).toContainText('Pushed');
  const files = await remote();
  return Object.keys(files).find(k => k.endsWith('.md'))!;
}

test('a push merges remote changes instead of overwriting them', async ({ context }) => {
  const page = await openApp(context);
  page.on('dialog', d => { throw new Error('unexpected native dialog: ' + d.message()); });
  await type(page, 'Plan', 'Line one.\n\nLine two.');
  const path = await pushed(page);
  await edit(path, 'Line two.', 'Line two.\n\nAdded on GitHub.');
  await setText(page, "'Added here.\\n\\n' + t");
  await page.evaluate(() => (window as any).pushRepos());
  await expect.poll(async () => (await remote())[path]).toMatch(/Added here\.[\s\S]*Added on GitHub\./);
});

test('a pull keeps local edits that were not pushed yet', async ({ context }) => {
  const page = await openApp(context);
  await type(page, 'Keep me', 'Original.');
  const path = await pushed(page);
  await edit(path, 'Original.', 'Original, edited on GitHub.');
  await page.evaluate(() => (window as any).pullRepos({ silent: true }));
  expect((await current(page)).text).toBe('Original, edited on GitHub.');
  await setText(page, "t + '\\n\\nNot pushed yet.'");
  await page.evaluate(() => (window as any).pullRepos({ silent: true }));
  expect((await current(page)).text).toContain('Not pushed yet.');
});

test('conflicting edits open the resolver', async ({ context }) => {
  const page = await openApp(context);
  await type(page, 'Both', 'Shared line.');
  const path = await pushed(page);
  await edit(path, 'Shared line.', 'Shared line (GitHub).');
  await setText(page, "t.replace('Shared line.', 'Shared line (mine).')");
  const pull = page.evaluate(() => (window as any).pullRepos({ silent: true }));
  const dialog = page.getByRole('dialog', { name: /Combine the two versions/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /Keep all from GitHub/ }).click();
  await dialog.getByRole('button', { name: 'Use this version' }).click();
  await pull;
  expect((await current(page)).text).toBe('Shared line (GitHub).');
});

test('deleting a note can delete the repository copy too', async ({ context }) => {
  const page = await openApp(context);
  await type(page, 'Delete me', 'Bye.');
  const path = await pushed(page);
  const id = (await current(page)).id;
  const del = page.evaluate(() => (window as any).deleteDailyNote());
  const dialog = page.getByRole('dialog', { name: /Delete “Delete me”/ });
  await dialog.getByLabel(/Also delete it from GitHub/).check();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await del;
  await expect.poll(async () => path in (await remote())).toBe(false);
  expect(await page.evaluate(i => !(window as any).__dailyEntries.findById(i), id)).toBe(true);
});

test('notes deleted in the repository are offered for review', async ({ context }) => {
  const page = await openApp(context);
  await type(page, 'Remote gone', 'Text.');
  const path = await pushed(page);
  await page.evaluate(() => (window as any).pullRepos({ silent: true }));
  await control(`/remote?op=delete&path=${encodeURIComponent(path)}`);
  const pull = page.evaluate(() => (window as any).pullRepos({ silent: true }));
  const dialog = page.getByRole('dialog', { name: /deleted in GitHub/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove from this browser' }).click();
  await pull;
  expect(await page.evaluate(() => (window as any).allEntries().some((e: any) => e.title === 'Remote gone'))).toBe(false);
});
