import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { createEmptyState } from '../src/model.js';
import { CACHE_KEY, SETTINGS_KEY, DB_NAME, loadCache, saveCache } from '../src/storage.js';

class MemoryStorage {
  constructor() { this.values = new Map(); this.rejectWrites = false; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) {
    if (this.rejectWrites) throw new DOMException('quota', 'QuotaExceededError');
    this.values.set(key, String(value));
  }
  removeItem(key) { this.values.delete(key); }
}

function deleteDatabase() {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('database delete blocked'));
  });
}

test.beforeEach(async () => {
  globalThis.indexedDB = fakeIndexedDB;
  globalThis.localStorage = new MemoryStorage();
  await deleteDatabase();
});

test('pre-IndexedDB full localStorage cache migrates to IndexedDB without data loss', async () => {
  const legacy = createEmptyState();
  legacy.profile.name = '相棒';
  legacy.records.push({ id:'legacy-1', title:'既存データ', body:'残す', updatedAt:'2026-08-02T00:00:00Z' });
  localStorage.setItem(CACHE_KEY, JSON.stringify(legacy));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(legacy.settings));

  const migrated = await loadCache();
  assert.equal(migrated.profile.name, '相棒');
  assert.equal(migrated.records[0].title, '既存データ');
  assert.equal(localStorage.getItem(CACHE_KEY), null);

  localStorage = new MemoryStorage();
  const reloaded = await loadCache();
  assert.equal(reloaded.profile.name, '相棒');
  assert.equal(reloaded.records[0].body, '残す');
});

test('full localStorage does not prevent IndexedDB state saves', async () => {
  const state = createEmptyState();
  state.profile.name = '保存確認';
  localStorage.rejectWrites = true;

  const saved = await saveCache(state);
  assert.equal(saved.profile.name, '保存確認');

  const reloaded = await loadCache();
  assert.equal(reloaded.profile.name, '保存確認');
});
