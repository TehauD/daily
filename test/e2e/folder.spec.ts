import { expect, test } from '@playwright/test';
import { control, current, openApp, type } from './helpers';

test.beforeEach(async () => { await control('/reset'); });

const sync = (page: any) => page.evaluate(() => (window as any).DailyVault.syncNow());
const flush = (page: any) => page.evaluate(() => (window as any).DailyVault.flushDirty());

test('every note is a Markdown file, and edits flow both ways', async ({ context }) => {
  const page = await openApp(context);
  await type(page, 'Cache plan', 'First line.');
  await flush(page);
  const { files } = await control('/vault');
  const path = Object.keys(files).find(p => p.includes('cache-plan--'))!;
  expect(path).toMatch(/^\d{4}\/\d{2}\/\d{2}\/cache-plan--[\w-]+\.md$/);
  expect(files[path]).toContain('First line.');

  await control(`/vault?op=replace&path=${encodeURIComponent(path)}&a=First%20line.&b=${encodeURIComponent('First line.\n\nEdited in another editor.')}`);
  await page.locator('#entryTitle').blur();
  await sync(page);
  expect((await current(page)).text).toContain('Edited in another editor.');
  await expect(page.locator('#entry')).toContainText('Edited in another editor.');
});

test('changes on both sides merge, and real conflicts ask', async ({ context }) => {
  const page = await openApp(context);
  await type(page, 'Merge me', 'alpha\n\nbeta\n\ngamma');
  await flush(page);
  const path = Object.keys((await control('/vault')).files)[0];

  await page.evaluate(() => { const B = (window as any).__dailyEntries; const e = B.findById(B.current().id); B.save({ ...e, text: 'top\n\n' + e.text }); });
  await control(`/vault?op=replace&path=${encodeURIComponent(path)}&a=gamma&b=${encodeURIComponent('gamma\n\nbottom')}`);
  await flush(page);
  await sync(page);
  const merged = (await current(page)).text;
  expect(merged.startsWith('top')).toBe(true);
  expect(merged.trim().endsWith('bottom')).toBe(true);

  await page.evaluate(() => { const B = (window as any).__dailyEntries; const e = B.findById(B.current().id); B.save({ ...e, text: e.text.replace('beta', 'beta (app)') }); });
  await control(`/vault?op=replace&path=${encodeURIComponent(path)}&a=beta&b=${encodeURIComponent('beta (disk)')}`);
  const pending = page.evaluate(() => (window as any).DailyVault.flushDirty().then(() => (window as any).DailyVault.syncNow()));
  const dialog = page.getByRole('dialog', { name: /Combine the two versions/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Use this version' })).toBeDisabled();
  await dialog.getByRole('radio', { name: 'Keep both' }).click();
  await dialog.getByRole('button', { name: 'Use this version' }).click();
  await pending;
  const text = (await current(page)).text;
  expect(text).toContain('beta (app)\nbeta (disk)');
  expect((await control('/vault')).files[path]).toContain('beta (app)\nbeta (disk)');
});

test('deleting a file removes the note, with undo', async ({ context }) => {
  const page = await openApp(context);
  await type(page, 'Short lived', 'Soon gone.');
  await flush(page);
  const path = Object.keys((await control('/vault')).files)[0];
  const id = (await current(page)).id;
  await control(`/vault?op=delete&path=${encodeURIComponent(path)}`);
  await sync(page);
  expect(await page.evaluate(i => !(window as any).__dailyEntries.findById(i), id)).toBe(true);
  await page.locator('#toast .toast-act').click();
  await expect.poll(() => page.evaluate(i => !!(window as any).__dailyEntries.findById(i), id)).toBe(true);
  await expect.poll(async () => Object.keys((await control('/vault')).files).length).toBe(1);
});

test('files added to the folder by hand are imported', async ({ context }) => {
  const page = await openApp(context);
  await control('/vault?op=write&path=2026/10/02/hand-written.md&content=' + encodeURIComponent('# Hand written\n\nCreated outside the app.\n'));
  await sync(page);
  const all = await page.evaluate(() => (window as any).allEntries().map((e: any) => [e.date, e.title, e.text]));
  expect(all).toContainEqual(['2026-10-02', 'Hand written', 'Created outside the app.']);
});
