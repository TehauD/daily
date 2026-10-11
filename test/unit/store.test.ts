// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { DailyStore, isBulk } from '../../src/core/storage/store';

let n = 0;
const db = () => 'test-' + ++n;

beforeEach(() => { localStorage.clear(); });

describe('DailyStore', () => {
  it('keeps journal data in IndexedDB and preferences in localStorage', async () => {
    const name = db();
    const s = await DailyStore.create({ idbFactory: new IDBFactory(), dbName: name, channelName: name });
    expect(s.info.mode).toBe('indexeddb');
    s.set('daily:entry:v2:2026-10-11:a', '{"text":"hi"}');
    s.set('daily:settings', '{"theme":"dark"}');
    expect(localStorage.getItem('daily:entry:v2:2026-10-11:a')).toBeNull();
    expect(localStorage.getItem('daily:settings')).toBe('{"theme":"dark"}');
    expect(s.get('daily:entry:v2:2026-10-11:a')).toBe('{"text":"hi"}');
    expect(s.keys().sort()).toEqual(['daily:entry:v2:2026-10-11:a', 'daily:settings']);
  });

  it('persists across sessions', async () => {
    const factory = new IDBFactory();
    const name = db();
    const a = await DailyStore.create({ idbFactory: factory, dbName: name, channelName: name });
    a.set('daily:entry:v2:2026-10-11:a', 'one');
    a.set('daily:base:a', 'base');
    a.rm('daily:base:a');
    await a.flush();
    const b = await DailyStore.create({ idbFactory: factory, dbName: name, channelName: name + 'b' });
    expect(b.get('daily:entry:v2:2026-10-11:a')).toBe('one');
    expect(b.get('daily:base:a')).toBeNull();
  });

  it('migrates pre-2.0 localStorage data once, keeping a backup', async () => {
    localStorage.setItem('daily:entry:v2:2026-09-01:x', '{"text":"old"}');
    localStorage.setItem('daily:sha:v2:github:x', 'abc');
    localStorage.setItem('daily:settings', '{"name":"T"}');
    const factory = new IDBFactory();
    const name = db();
    const s = await DailyStore.create({ idbFactory: factory, dbName: name, channelName: name });
    expect(s.get('daily:entry:v2:2026-09-01:x')).toBe('{"text":"old"}');
    expect(s.info.migratedCount).toBe(2);
    expect(localStorage.getItem('daily:entry:v2:2026-09-01:x')).toBeNull();
    expect(localStorage.getItem('daily:settings')).toBe('{"name":"T"}');
    expect(Object.keys((await s.legacyBackup()) || {}).sort()).toEqual(['daily:entry:v2:2026-09-01:x', 'daily:sha:v2:github:x']);
    // A later stray localStorage write never overrides newer database data.
    s.set('daily:entry:v2:2026-09-01:x', '{"text":"new"}');
    await s.flush();
    localStorage.setItem('daily:entry:v2:2026-09-01:x', '{"text":"stale"}');
    const again = await DailyStore.create({ idbFactory: factory, dbName: name, channelName: name + 'c' });
    expect(again.get('daily:entry:v2:2026-09-01:x')).toBe('{"text":"new"}');
  });

  it('falls back to localStorage without IndexedDB', async () => {
    const s = await DailyStore.create({ idbFactory: null });
    expect(s.info.mode).toBe('localStorage');
    s.set('daily:entry:v2:2026-10-11:a', 'x');
    expect(localStorage.getItem('daily:entry:v2:2026-10-11:a')).toBe('x');
  });

  it('notifies listeners and other tabs', async () => {
    const factory = new IDBFactory();
    const name = db();
    const a = await DailyStore.create({ idbFactory: factory, dbName: name, channelName: name });
    const b = await DailyStore.create({ idbFactory: factory, dbName: name, channelName: name });
    const seen: string[] = [];
    a.on((k, v, src) => seen.push(`${src}:${k}=${v}`));
    const remote = new Promise<string>(resolve => b.on((k, v, src) => { if (src === 'remote') resolve(`${k}=${v}`); }));
    a.set('daily:entry:v2:2026-10-11:a', 'hello');
    await a.flush();
    expect(seen).toEqual(['local:daily:entry:v2:2026-10-11:a=hello']);
    expect(await remote).toBe('daily:entry:v2:2026-10-11:a=hello');
    expect(b.get('daily:entry:v2:2026-10-11:a')).toBe('hello');
  });

  it('classifies keys', () => {
    expect(isBulk('daily:entry:v2:2026-01-01:a')).toBe(true);
    expect(isBulk('daily:vault:state:a')).toBe(true);
    expect(isBulk('daily:settings')).toBe(false);
    expect(isBulk('daily:provider')).toBe(false);
  });
});
