import { SCHEMA_VERSION, normalizeState, touchState, isoNow } from './model.js';

export const CACHE_KEY = 'life_compass_ai_os_cache_v1';
export const SETTINGS_KEY = 'life_compass_ai_os_settings_v1';

export function loadCache() {
  try { return normalizeState(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')); }
  catch { return normalizeState({}); }
}

export function saveCache(state, { touch = true } = {}) {
  const next = touch ? touchState(state) : normalizeState(state);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next.settings));
  } catch (error) {
    throw new Error('端末の保存容量が不足しています。JSONバックアップを書き出してから、不要なサイトデータを整理してください。');
  }
  return next;
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
  for (const key of ['records','goals','habits','healthItems','timeline','comparisons','products','reviews','simulations']) {
    const map = new Map();
    for (const row of [...c[key], ...l[key]]) map.set(row.id, map.has(row.id) ? newer(row, map.get(row.id)) : row);
    out[key] = [...map.values()];
  }
  out.profile = mergeProfile(l.profile, c.profile);
  out.settings = { ...c.settings, ...l.settings, gasUrl: l.settings.gasUrl || c.settings.gasUrl };
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
  return { fileId: json.fileId, name: json.name, url: json.url, mimeType: file.type, size: file.size, uploadedAt: isoNow() };
}
