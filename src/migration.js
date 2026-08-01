import { createEmptyState, normalizeRecord, normalizeState, isoNow, uid } from './model.js';

const ARRAY_ALIASES = {
  records: ['records', 'entries', 'logs', 'mind_logs', 'items', 'current', 'mind', 'insights', 'premises', 'imports'],
  goals: ['goals', 'mind_goals', 'future'],
  habits: ['habits'],
  healthItems: ['healthItems', 'health', 'medical'],
  timeline: ['timeline', 'life_events'],
  comparisons: ['comparisons', 'lifeComparisons'],
  products: ['products', 'productIdeas'],
  reviews: ['reviews', 'reflections'],
  simulations: ['simulations']
};

const PROFILE_FIELDS = {
  name: 'name', birthDate: 'birthDate', age: 'age', location: 'location',
  familyStructure: 'family', family: 'family', medicalHistory: 'medicalHistory',
  likedThings: 'likes', likes: 'likes', strongThings: 'strengths', strengths: 'strengths',
  workHistory: 'workHistory', traumaHistory: 'trauma', trauma: 'trauma',
  values: 'values', personalityTraits: 'personality', personality: 'personality',
  currentConstraints: 'constraints', constraints: 'constraints',
  supportNeeded: 'supportNeeds', supportNeeds: 'supportNeeds',
  memo: 'notes', notes: 'notes', currentSatisfaction: 'satisfaction', satisfaction: 'satisfaction'
};

const PROFILE_AUX_FIELDS = [
  'lifeTimeline', 'pastIdealLife', 'pastIdealReason', 'currentReality',
  'currentSatisfaction', 'newDesiredLife', 'newIdealReason', 'lifeGapHealth',
  'lifeGapWork', 'lifeGapMoney', 'lifeGapFamily', 'lifeGapFreedom',
  'lifeComparisonAnalysis', 'lifeComparisonUpdatedAt', 'profileUpdatedAt',
  'createdAt', 'updatedAt', 'aiProvider'
];

const DOMAIN_WORDS = {
  health: ['health', '健康', '体調', '視力', '腰痛', '血圧', '睡眠', '運動'],
  work: ['work', '仕事', '事業', '経営', '商品', 'webrich'],
  income: ['income', 'money', 'お金', '収入', '家計', '支出'],
  freedom: ['freedom', '自由', '旅', '旅行', '行きたい場所'],
  family: ['family', '家族', '介護'],
  challenge: ['challenge', '挑戦', '目標'],
  learning: ['learning', '学び', '勉強', '知識'],
  happiness: ['happiness', '幸福', '感情', '嬉しい', '期待', '不安', '焦り', '怒り']
};

function unwrap(input) {
  if (input?.format === 'LifeCompassAIOS' && input.state) return input.state;
  if (input?.state && typeof input.state === 'object') return input.state;
  if (input?.data && typeof input.data === 'object') return input.data;
  return input || {};
}

function pickArrays(source, aliases) {
  const found = [];
  for (const key of aliases) {
    if (Array.isArray(source[key])) found.push(...source[key].map(row => ({ row, section: key })));
  }
  return found;
}

function isDateTime(value) {
  return typeof value === 'string' && value.trim() && !Number.isNaN(Date.parse(value));
}

function deepestOriginal(input) {
  let row = input && typeof input === 'object' ? input : {};
  const rootId = row.id;
  const seen = new Set();
  let depth = 0;
  while (depth < 20 && typeof row.driveViewUrl === 'string' && row.driveViewUrl.trim().startsWith('{')) {
    if (seen.has(row.driveViewUrl)) break;
    seen.add(row.driveViewUrl);
    try {
      const payload = JSON.parse(row.driveViewUrl);
      if (!payload.raw || typeof payload.raw !== 'object') break;
      if (rootId && payload.raw.id && payload.raw.id !== rootId) break;
      row = payload.raw;
      depth += 1;
    } catch { break; }
  }
  return { row, depth };
}

function inferDomain(row, section) {
  const haystack = [row.domain, row.category, row.tags, section].filter(Boolean).join(' ').toLowerCase();
  for (const [domain, words] of Object.entries(DOMAIN_WORDS)) {
    if (words.some(word => haystack.includes(word.toLowerCase()))) return domain;
  }
  if (section === 'future') return 'freedom';
  if (section === 'mind' || section === 'insights' || section === 'reflections') return 'happiness';
  return 'happiness';
}

function cleanLegacyRecord(input, target, originalSection, stats) {
  const recovered = deepestOriginal(input);
  const row = recovered.row;
  if (recovered.depth) {
    stats.repaired += 1;
    stats.payloadLayersRemoved += recovered.depth;
  }
  const kind = target.replace(/s$/, '');
  const createdAt = isDateTime(row.createdAt) ? row.createdAt : (isDateTime(row.updatedAt) ? row.updatedAt : undefined);
  const updatedAt = isDateTime(row.updatedAt) ? row.updatedAt : createdAt;
  const sourceLink = [row.linkUrl, row.imageUrl, row.createdAt].find(value => typeof value === 'string' && /^https?:\/\//i.test(value)) || '';
  return normalizeRecord({
    ...row,
    id: row.id || input.id || uid(`legacy_${kind}`),
    domain: inferDomain(row, originalSection),
    createdAt,
    updatedAt,
    source: 'legacy-json',
    legacy: {
      originalSection,
      originalCategory: row.category || '',
      sourceLink,
      repairedPayloadDepth: recovered.depth
    }
  }, kind);
}

function cleanProfile(rawProfile, stats) {
  const recovered = deepestOriginal(rawProfile || {});
  if (recovered.depth) {
    stats.profileRepaired = true;
    stats.payloadLayersRemoved += recovered.depth;
  }
  const mergedProfile = { ...recovered.row };
  for (const key of [...Object.keys(PROFILE_FIELDS), ...PROFILE_AUX_FIELDS]) {
    const value = rawProfile?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') mergedProfile[key] = value;
  }
  const result = {};
  for (const [oldKey, newKey] of Object.entries(PROFILE_FIELDS)) {
    const value = mergedProfile[oldKey];
    if (value !== undefined && value !== null && String(value).trim() !== '') result[newKey] = value;
  }
  result.updatedAt = isDateTime(mergedProfile.profileUpdatedAt)
    ? mergedProfile.profileUpdatedAt
    : (isDateTime(mergedProfile.updatedAt) ? mergedProfile.updatedAt : isoNow());
  stats.profileFields = Object.keys(result).filter(key => key !== 'updatedAt').length;
  return { profile: result, raw: mergedProfile };
}

function fingerprint(row) {
  return [row.kind, row.domain, row.title.trim().toLowerCase(), row.body.trim().toLowerCase(), row.date].join('|');
}

function aiFingerprint(row) {
  return [row.provider, row.model, row.mode, row.question, row.answer].map(value => String(value || '').trim()).join('|');
}

function normalizeAiHistory(rows, stats) {
  const sorted = [...rows].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  const seen = new Set();
  const result = [];
  for (const row of sorted) {
    const fp = aiFingerprint(row);
    if (seen.has(fp)) { stats.duplicates += 1; continue; }
    seen.add(fp);
    const createdAt = isDateTime(row.createdAt) ? row.createdAt : isoNow();
    result.push({ ...row, id: row.id || uid('legacy_ai'), createdAt, updatedAt: isDateTime(row.updatedAt) ? row.updatedAt : createdAt, source: 'legacy-json' });
  }
  return result.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function appendProfileRecords(candidate, profileRaw, stats) {
  if (String(profileRaw.lifeTimeline || '').trim()) {
    candidate.timeline.push(normalizeRecord({
      id: 'legacy_profile_life_timeline', kind: 'timeline', domain: 'happiness',
      title: '旧Life Compassの人生年表', body: profileRaw.lifeTimeline,
      createdAt: profileRaw.createdAt, updatedAt: profileRaw.profileUpdatedAt || profileRaw.updatedAt,
      source: 'legacy-json', legacy: { originalSection: 'profile.lifeTimeline' }
    }, 'timeline'));
    stats.profileDerivedRecords += 1;
  }
  const comparisonFields = [
    ['過去の理想', profileRaw.pastIdealLife], ['過去に理想とした理由', profileRaw.pastIdealReason],
    ['現在', profileRaw.currentReality], ['現在の満足度', profileRaw.currentSatisfaction],
    ['新しい理想', profileRaw.newDesiredLife], ['新しい理想の理由', profileRaw.newIdealReason],
    ['健康の差', profileRaw.lifeGapHealth], ['仕事の差', profileRaw.lifeGapWork],
    ['収入の差', profileRaw.lifeGapMoney], ['家族の差', profileRaw.lifeGapFamily],
    ['自由の差', profileRaw.lifeGapFreedom], ['旧AI分析', profileRaw.lifeComparisonAnalysis]
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim());
  if (comparisonFields.length) {
    candidate.comparisons.push(normalizeRecord({
      id: 'legacy_profile_life_comparison', kind: 'comparison', domain: 'happiness',
      title: '旧Life Compassの人生比較',
      body: comparisonFields.map(([label, value]) => `【${label}】\n${value}`).join('\n\n'),
      createdAt: profileRaw.createdAt, updatedAt: profileRaw.lifeComparisonUpdatedAt || profileRaw.updatedAt,
      source: 'legacy-json', legacy: { originalSection: 'profile.lifeComparison' }
    }, 'comparison'));
    stats.profileDerivedRecords += 1;
  }
}

export function inspectLegacyJson(input, currentState = createEmptyState()) {
  const raw = unwrap(input);
  const candidate = createEmptyState();
  const issues = [];
  const stats = {
    imported: 0, duplicates: 0, conflicts: 0, ignored: 0,
    repaired: 0, payloadLayersRemoved: 0, profileFields: 0,
    profileDerivedRecords: 0, profileRepaired: false
  };

  const profileResult = cleanProfile(raw.profile || raw.userProfile || {}, stats);
  candidate.profile = { ...candidate.profile, ...profileResult.profile };
  candidate.profile.fieldUpdatedAt = Object.fromEntries(
    Object.keys(profileResult.profile).filter(key => key !== 'updatedAt')
      .map(key => [key, profileResult.profile.updatedAt || isoNow()])
  );
  candidate.scores = { ...candidate.scores, ...(raw.scores || raw.lifeScores || {}) };
  const scoreTime = raw.meta?.updatedAt || profileResult.profile.updatedAt || isoNow();
  candidate.scoreUpdatedAt = { ...candidate.scoreUpdatedAt, ...(raw.scoreUpdatedAt ||
    Object.fromEntries(Object.keys(raw.scores || raw.lifeScores || {}).map(key => [key, scoreTime]))) };
  candidate.settings = { ...candidate.settings, ...(raw.settings || {}) };
  if (['gemini', 'openai'].includes(profileResult.raw.aiProvider)) candidate.settings.provider = profileResult.raw.aiProvider;
  candidate.settings.gasUrl = '';
  candidate.settings.syncEnabled = false;

  for (const [target, aliases] of Object.entries(ARRAY_ALIASES)) {
    const rows = pickArrays(raw, aliases);
    candidate[target] = rows.map(({ row, section }) => cleanLegacyRecord(row, target, section, stats));
  }
  appendProfileRecords(candidate, profileResult.raw, stats);
  candidate.aiHistory = normalizeAiHistory(Array.isArray(raw.aiHistory) ? raw.aiHistory : [], stats);

  const duplicateIds = new Set();
  for (const key of Object.keys(ARRAY_ALIASES)) {
    const existingById = new Map(currentState[key].map(item => [item.id, item]));
    const existingByFp = new Map(currentState[key].map(item => [fingerprint(item), item]));
    const incomingByFp = new Map();
    for (const row of candidate[key]) {
      const fp = fingerprint(row);
      const sameId = existingById.get(row.id);
      if (existingByFp.has(fp) || incomingByFp.has(fp)) {
        duplicateIds.add(row.id);
        stats.duplicates += 1;
      } else if (sameId && fingerprint(sameId) !== fp) {
        stats.conflicts += 1;
      }
      incomingByFp.set(fp, row);
    }
  }

  const recordCount = Object.keys(ARRAY_ALIASES).reduce((total, key) => total + candidate[key].length, 0);
  stats.imported = recordCount + candidate.aiHistory.length - duplicateIds.size;
  if (!stats.imported && !stats.profileFields) issues.push('読み込める記録やプロフィールが見つかりませんでした。');
  if (stats.repaired) issues.push(`旧同期で列がずれた${stats.repaired}件を、記録内に残った元データから復元します。`);
  if (stats.profileRepaired) issues.push('プロフィールは記録用の混入項目を除外し、プロフィール項目だけを復元します。');
  if (raw.profile?.gasUrl) issues.push('旧版の同期URLは新OSへ引き継がず、新しい同期設定を使用します。');
  return { candidate: normalizeState(candidate), stats, issues, duplicateIds: [...duplicateIds] };
}

export function applyMigration(currentState, inspection, choices = {}) {
  const current = normalizeState(currentState), incoming = normalizeState(inspection.candidate);
  const out = normalizeState(current);
  const duplicateSet = new Set(inspection.duplicateIds || []);
  for (const key of Object.keys(ARRAY_ALIASES)) {
    const map = new Map(current[key].map(row => [row.id, row]));
    for (const row of incoming[key]) {
      if (duplicateSet.has(row.id)) continue;
      if (!map.has(row.id)) map.set(row.id, row);
      else if (choices.conflict === 'incoming') map.set(row.id, row);
      else if (choices.conflict === 'keep_both') map.set(uid(`${row.id}_copy`), { ...row, id: uid('migrated') });
    }
    out[key] = [...map.values()];
  }
  const aiMap = new Map(out.aiHistory.map(row => [row.id || aiFingerprint(row), row]));
  const aiContent = new Set(out.aiHistory.map(aiFingerprint));
  for (const row of incoming.aiHistory) {
    if (!aiContent.has(aiFingerprint(row))) aiMap.set(row.id || uid('migrated_ai'), row);
  }
  out.aiHistory = [...aiMap.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(-100);
  if (choices.profile === 'incoming') out.profile = incoming.profile;
  else if (choices.profile === 'fill_empty') {
    for (const [key, value] of Object.entries(incoming.profile)) {
      if (['fieldUpdatedAt'].includes(key)) continue;
      if (!out.profile[key] && value) {
        out.profile[key] = value;
        out.profile.fieldUpdatedAt[key] = incoming.profile.fieldUpdatedAt?.[key] || incoming.profile.updatedAt;
      }
    }
  }
  out.meta.updatedAt = isoNow();
  out.meta.migratedAt = isoNow();
  out.meta.migrationSource = 'legacy-json';
  return out;
}

function migratedItemCount(state) {
  return [...Object.keys(ARRAY_ALIASES), 'aiHistory']
    .reduce((total, key) => total + (state[key]?.length || 0), 0);
}

function repairedRecordIds(inspection) {
  const ids = new Set();
  for (const key of Object.keys(ARRAY_ALIASES)) {
    for (const row of inspection.candidate[key] || []) {
      if (row.legacy?.repairedPayloadDepth) ids.add(`${row.kind}:${row.id}`);
    }
  }
  return ids;
}

/**
 * Inspect multiple device backups as one migration job. More complete profiles
 * are processed first, while records and AI history are always unioned by
 * content/ID. The supplied current state is never mutated during inspection.
 */
export function inspectLegacyJsonBatch(inputs, currentState = createEmptyState()) {
  const sources = (Array.isArray(inputs) ? inputs : [inputs]).filter(Boolean);
  if (!sources.length) throw new Error('比較するJSONが選択されていません。');

  const ranked = sources.map((input, originalIndex) => {
    const standalone = inspectLegacyJson(input, createEmptyState());
    return { input, originalIndex, profileFields: standalone.stats.profileFields };
  }).sort((a, b) => b.profileFields - a.profileFields || a.originalIndex - b.originalIndex);

  let previewState = normalizeState(currentState);
  const inspections = [];
  const repairedIds = new Set();
  const issueSet = new Set();
  const stats = {
    imported: 0, duplicates: 0, conflicts: 0, ignored: 0,
    repaired: 0, payloadLayersRemoved: 0, profileFields: 0,
    profileDerivedRecords: 0, profileRepaired: false, sourceCount: ranked.length
  };

  const beforeCount = migratedItemCount(previewState);
  ranked.forEach(({ input }, index) => {
    const inspection = inspectLegacyJson(input, previewState);
    inspections.push(inspection);
    stats.duplicates += inspection.stats.duplicates;
    stats.conflicts += inspection.stats.conflicts;
    stats.ignored += inspection.stats.ignored;
    stats.payloadLayersRemoved = Math.max(stats.payloadLayersRemoved, inspection.stats.payloadLayersRemoved);
    stats.profileFields = Math.max(stats.profileFields, inspection.stats.profileFields);
    stats.profileRepaired ||= inspection.stats.profileRepaired;
    inspection.issues.forEach(issue => issueSet.add(issue));
    repairedRecordIds(inspection).forEach(id => repairedIds.add(id));
    previewState = applyMigration(previewState, inspection, {
      profile: index === 0 ? 'fill_empty' : 'fill_empty', conflict: 'current'
    });
  });

  stats.imported = migratedItemCount(previewState) - beforeCount;
  stats.repaired = repairedIds.size;
  stats.profileDerivedRecords = Math.max(0,
    (previewState.timeline.length + previewState.comparisons.length)
    - (currentState.timeline?.length || 0) - (currentState.comparisons?.length || 0));

  return {
    batch: true,
    sources: ranked.map(x => x.input),
    inspections,
    previewState,
    stats,
    issues: [...issueSet],
    duplicateIds: []
  };
}

export function applyMigrationBatch(currentState, batchInspection, choices = {}) {
  if (!batchInspection?.batch) return applyMigration(currentState, batchInspection, choices);
  let out = normalizeState(currentState);
  batchInspection.sources.forEach((source, index) => {
    const inspection = inspectLegacyJson(source, out);
    const profileChoice = choices.profile === 'incoming'
      ? (index === 0 ? 'incoming' : 'fill_empty')
      : choices.profile;
    out = applyMigration(out, inspection, { ...choices, profile: profileChoice });
  });
  return out;
}
