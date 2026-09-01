import { SCHEMA_VERSION, normalizeState, touchState, isoNow } from './model.js';

export const CACHE_KEY = 'life_compass_ai_os_cache_v1';
export const SETTINGS_KEY = 'life_compass_ai_os_settings_v1';
export const DB_NAME = 'life_compass_ai_os';
export const DB_STORE = 'state';
export const DB_STATE_KEY = 'main';
const LEGACY_FALLBACK_LIMIT_BYTES = 1_500_000;

function readLocalJson(key) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch (_) { return null; }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is unavailable'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked'));
  });
}

async function readDatabaseState() {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_STATE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('IndexedDB read failed'));
    });
  } finally { db.close(); }
}

async function writeDatabaseState(state) {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, 'readwrite');
      transaction.objectStore(DB_STORE).put(state, DB_STATE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB write failed'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB write aborted'));
    });
  } finally { db.close(); }
}

function waitForRetry(delay = 90) {
  return new Promise(resolve => setTimeout(resolve, delay));
}

function storageErrorMessage(error) {
  const name = String(error?.name || '');
  const message = String(error?.message || '');
  if (/quota|space|容量/i.test(`${name} ${message}`)) {
    return 'スマホの保存容量が不足しています。クラウド同期またはJSONバックアップを確認してから、ブラウザの不要なサイトデータを整理してください。';
  }
  if (/private|security|denied|notallowed/i.test(`${name} ${message}`)) {
    return 'スマホのブラウザが端末保存を許可していません。プライベートモードを終了し、通常の画面で開いてください。';
  }
  return 'スマホの端末保存が一時的に失敗しました。画面を閉じずにもう一度保存してください。クラウド接続中はクラウド保存へ自動で切り替えます。';
}

async function writeAndVerifyDatabaseState(state) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeDatabaseState(state);
      const verified = await readDatabaseState();
      if (!verified || Number(verified?.meta?.revision) !== Number(state?.meta?.revision)) {
        throw new Error('IndexedDB verification failed');
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await waitForRetry();
    }
  }
  throw lastError || new Error('IndexedDB write failed');
}

async function deleteDatabaseState() {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, 'readwrite');
      transaction.objectStore(DB_STORE).delete(DB_STATE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB delete failed'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB delete aborted'));
    });
  } finally { db.close(); }
}

function mirrorLightSettings(settings) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch (_) { return false; }
}

function removeLegacyFullCache() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(CACHE_KEY);
  } catch (_) { /* 他ツールのデータには触れず、Life Compassの旧キーだけを対象にする。 */ }
}

export async function loadCache() {
  let databaseState = null;
  try { databaseState = await readDatabaseState(); }
  catch (_) { /* 非対応環境では旧キャッシュへ安全にフォールバックする。 */ }
  if (databaseState) return normalizeState(databaseState);

  const legacyState = readLocalJson(CACHE_KEY);
  const lightSettings = readLocalJson(SETTINGS_KEY);
  const next = normalizeState(legacyState || (lightSettings ? { settings: lightSettings } : {}));

  // v2.1.2以前の全量localStorageを、初回起動時に容量の大きいIndexedDBへ自動移行する。
  try {
    // iOS系ブラウザでは、バックグラウンド復帰直後にIndexedDBのトランザクションが
    // 一度だけ失敗することがある。再試行し、読み返しまで成功した時だけ保存完了とする。
    await writeAndVerifyDatabaseState(next);
    mirrorLightSettings(next.settings);
    removeLegacyFullCache();
  } catch (_) {
    // 移行できない環境でも、読み取れた既存データは画面上で維持する。
  }
  return next;
}

export async function saveCache(state, { touch = true } = {}) {
  // 旧スマホ版や部分更新されたキャッシュが混ざっていても、保存のたびに
  // 現行スキーマへ整えてから画面へ返す。欠けた配列・AI履歴を残さない。
  const normalized = normalizeState(state);
  const next = touch ? touchState(normalized) : normalized;
  try {
    await writeAndVerifyDatabaseState(next);
    mirrorLightSettings(next.settings);
    removeLegacyFullCache();
    return next;
  } catch (databaseError) {
    // 古いブラウザ向けの最終フォールバック。大きな本体データを容量の小さい
    // localStorageへ戻すとスマホの容量エラーが再発するため、小規模データだけに限定する。
    try {
      if (typeof localStorage === 'undefined') throw databaseError;
      const serialized = JSON.stringify(next);
      if (new Blob([serialized]).size > LEGACY_FALLBACK_LIMIT_BYTES) throw databaseError;
      localStorage.setItem(CACHE_KEY, serialized);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next.settings));
      return next;
    } catch (fallbackError) {
      const error = new Error(storageErrorMessage(fallbackError || databaseError));
      error.name = 'LifeCompassStorageError';
      error.storageCause = databaseError;
      throw error;
    }
  }
}

export async function storageStatus() {
  let usage = null;
  let quota = null;
  try {
    const estimate = await globalThis.navigator?.storage?.estimate?.();
    usage = Number.isFinite(Number(estimate?.usage)) ? Number(estimate.usage) : null;
    quota = Number.isFinite(Number(estimate?.quota)) ? Number(estimate.quota) : null;
  } catch (_) { /* 容量表示に非対応でも保存処理は継続する。 */ }
  try {
    const stored = await readDatabaseState();
    return { ok: Boolean(stored), engine: 'IndexedDB', usage, quota };
  } catch (error) {
    return { ok: false, engine: 'IndexedDB', usage, quota, error: storageErrorMessage(error) };
  }
}

export async function clearLocalCache() {
  try { await deleteDatabaseState(); }
  catch (_) { /* IndexedDBが使えない環境でもLife Compassの旧キーは整理する。 */ }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(SETTINGS_KEY);
    }
  } catch (_) { /* ignore */ }
}

export function exportBackup(state) {
  const payload = { format: 'LifeCompassAIOS', exportedAt: isoNow(), schemaVersion: SCHEMA_VERSION, state: normalizeState(state) };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

export async function fetchCloud(gasUrl, token = '') {
  if (!gasUrl) throw new Error('同期URLが未設定です');
  if (!token) throw new Error('同期トークンが未設定です');
  const res = await fetch(gasUrl, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'load', token })
  });
  if (!res.ok) throw new Error(`クラウド接続に失敗しました（${res.status}）`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'クラウドデータを取得できませんでした');
  return normalizeState(json.state || {});
}

export async function pushCloud(gasUrl, token, state) {
  if (!gasUrl) throw new Error('同期URLが未設定です');
  if (!token) throw new Error('同期トークンが未設定です');
  const res = await fetch(gasUrl, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'sync', token, state: normalizeState(state), clientRevision: state.meta.revision })
  });
  if (!res.ok) throw new Error(`クラウド保存に失敗しました（${res.status}）`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'クラウドへ保存できませんでした');
  return normalizeState(json.state);
}

function newer(a, b) {
  return new Date(a?.updatedAt || a?.createdAt || 0) >= new Date(b?.updatedAt || b?.createdAt || 0) ? a : b;
}

export function mergeProfile(localProfile = {}, cloudProfile = {}) {
  const out = { ...cloudProfile, fieldUpdatedAt: { ...(cloudProfile.fieldUpdatedAt || {}) } };
  const lTimes = localProfile.fieldUpdatedAt || {};
  const cTimes = cloudProfile.fieldUpdatedAt || {};
  const fallbackLocal = localProfile.updatedAt || 0;
  const fallbackCloud = cloudProfile.updatedAt || 0;
  const ignored = new Set(['id', 'updatedAt', 'fieldUpdatedAt']);
  for (const key of new Set([...Object.keys(cloudProfile), ...Object.keys(localProfile)])) {
    if (ignored.has(key)) continue;
    const lValue = localProfile[key];
    const cValue = cloudProfile[key];
    const lTime = new Date(lTimes[key] || fallbackLocal || 0);
    const cTime = new Date(cTimes[key] || fallbackCloud || 0);
    if ((lValue !== '' && lValue != null) && ((cValue === '' || cValue == null) || lTime >= cTime)) {
      out[key] = lValue;
      out.fieldUpdatedAt[key] = lTimes[key] || fallbackLocal;
    }
  }
  out.id = localProfile.id || cloudProfile.id || 'profile_main';
  out.updatedAt = new Date(fallbackLocal) >= new Date(fallbackCloud) ? fallbackLocal : fallbackCloud;
  return out;
}

export function mergeScores(local, cloud) {
  const scores = { ...cloud.scores };
  const updatedAt = { ...cloud.scoreUpdatedAt };
  for (const key of new Set([...Object.keys(cloud.scores || {}), ...Object.keys(local.scores || {})])) {
    const lTime = new Date(local.scoreUpdatedAt?.[key] || 0);
    const cTime = new Date(cloud.scoreUpdatedAt?.[key] || 0);
    if (lTime >= cTime) {
      scores[key] = local.scores[key];
      updatedAt[key] = local.scoreUpdatedAt?.[key] || updatedAt[key] || '';
    }
  }
  return { scores, scoreUpdatedAt: updatedAt };
}

export function mergeStates(local, cloud) {
  const l = normalizeState(local), c = normalizeState(cloud);
  const out = normalizeState(c);
  for (const key of ['records','goals','habits','wishes','healthItems','timeline','comparisons','products','reviews','simulations','futureVisions']) {
    const map = new Map();
    for (const row of [...c[key], ...l[key]]) map.set(row.id, map.has(row.id) ? newer(row, map.get(row.id)) : row);
    out[key] = [...map.values()];
  }
  out.profile = mergeProfile(l.profile, c.profile);
  out.settings = {
    ...c.settings, ...l.settings,
    gasUrl: l.settings.gasUrl || c.settings.gasUrl,
    integrations: {
      ...(c.settings.integrations || {}), ...(l.settings.integrations || {}),
      line: {
        ...(c.settings.integrations?.line || {}), ...(l.settings.integrations?.line || {}),
        scopes: {
          ...(c.settings.integrations?.line?.scopes || {}),
          ...(l.settings.integrations?.line?.scopes || {})
        }
      },
      gpt: {
        ...(c.settings.integrations?.gpt || {}), ...(l.settings.integrations?.gpt || {}),
        scopes: {
          ...(c.settings.integrations?.gpt?.scopes || {}),
          ...(l.settings.integrations?.gpt?.scopes || {})
        }
      },
      universal: {
        ...(c.settings.integrations?.universal || {}), ...(l.settings.integrations?.universal || {}),
        scopes: {
          ...(c.settings.integrations?.universal?.scopes || {}),
          ...(l.settings.integrations?.universal?.scopes || {})
        }
      },
      cost: {
        ...(c.settings.integrations?.cost || {}),
        ...(l.settings.integrations?.cost || {})
      }
    }
  };
  const scoreMerge = mergeScores(l, c);
  out.scores = scoreMerge.scores;
  out.scoreUpdatedAt = scoreMerge.scoreUpdatedAt;
  out.meta = { ...c.meta, revision: Math.max(l.meta.revision, c.meta.revision), updatedAt: isoNow(), lastSyncedAt: isoNow() };
  out.aiHistory = [...c.aiHistory, ...l.aiHistory]
    .filter((x, i, arr) => arr.findIndex(y => (y.id && y.id === x.id) || (!y.id && y.createdAt === x.createdAt && y.question === x.question)) === i)
    .sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(-100);
  return out;
}

export async function synchronize(state) {
  const { gasUrl, syncToken } = state.settings;
  const cloud = await fetchCloud(gasUrl, syncToken);
  const merged = mergeStates(state, cloud);
  const saved = await pushCloud(gasUrl, syncToken, merged);
  saved.settings = { ...saved.settings, gasUrl, syncToken };
  return saveCache({ ...saved, meta: { ...saved.meta, lastSyncedAt: isoNow() } }, { touch: false });
}


export async function refreshNotebookLMSheets(state) {
  const gasUrl = state?.settings?.gasUrl || '';
  const token = state?.settings?.syncToken || '';
  if (!gasUrl) throw new Error('設定画面でGAS同期URLを登録してください');
  if (!token) throw new Error('設定画面で同期トークンを登録してください');
  const res = await fetch(gasUrl, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'refresh_notebooklm', token })
  });
  if (!res.ok) throw new Error(`NotebookLM用シートの更新に失敗しました（${res.status}）`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'NotebookLM用シートを更新できませんでした');
  return json;
}

export async function fetchMedicalUpdates(state, topics = [], customTopics = []) {
  const gasUrl = state?.settings?.gasUrl || '';
  const token = state?.settings?.syncToken || '';
  if (!gasUrl) throw new Error('医療情報の確認には、設定画面でGAS同期URLを登録してください');
  if (!token) throw new Error('医療情報の確認には、設定画面で同期トークンを登録してください');
  const selected = Array.isArray(topics) ? topics.map(String).filter(Boolean).slice(0, 8) : [];
  if (!selected.length) throw new Error('確認したい医療テーマを1つ以上選んでください');
  const res = await fetch(gasUrl, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action:'medical_updates', token, topics:selected, maxPerTopic:4,
      customTopics:Array.isArray(customTopics) ? customTopics.slice(0,20).map(item => ({
        id:String(item?.id || ''), label:String(item?.label || '').slice(0,60), query:String(item?.query || '').slice(0,140)
      })) : []
    })
  });
  if (!res.ok) throw new Error(`医療情報を取得できませんでした（${res.status}）`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || '医療情報を取得できませんでした');
  return {
    checkedAt: String(json.checkedAt || isoNow()),
    results: Array.isArray(json.results) ? json.results.slice(0, 60) : [],
    warnings: Array.isArray(json.warnings) ? json.warnings : [],
    sources: Array.isArray(json.sources) ? json.sources : []
  };
}

export async function testConnection(gasUrl, token) {
  const state = await fetchCloud(gasUrl, token);
  return { ok: true, revision: Number(state.meta?.revision || 0) };
}

export async function uploadAttachment(state, file) {
  if (!state.settings.gasUrl || !state.settings.syncToken) throw new Error('添付には同期URLと同期トークンが必要です');
  if (file.size > 8 * 1024 * 1024) throw new Error('添付は1ファイル8MB以下にしてください');
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('添付ファイルを読み込めませんでした'));
    reader.readAsDataURL(file);
  });
  const res = await fetch(state.settings.gasUrl, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
    body: JSON.stringify({ action: 'upload', token: state.settings.syncToken, fileName: file.name, mimeType: file.type, base64 })
  });
  if (!res.ok) throw new Error(`添付の保存に失敗しました（${res.status}）`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || '添付を保存できませんでした');
  return { fileId: json.fileId, name: json.name, url: json.url, previewUrl: json.previewUrl || json.url, mimeType: file.type, size: file.size, uploadedAt: isoNow() };
}
