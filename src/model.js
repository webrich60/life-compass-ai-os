export const SCHEMA_VERSION = 2;

export const DOMAINS = [
  { id: 'health', label: '健康', icon: 'heart-pulse', color: '#16a085' },
  { id: 'work', label: '仕事', icon: 'briefcase', color: '#4f6bed' },
  { id: 'income', label: '収入', icon: 'wallet', color: '#d99000' },
  { id: 'freedom', label: '自由', icon: 'compass', color: '#8b5cf6' },
  { id: 'happiness', label: '幸福', icon: 'sparkles', color: '#e96a8d' },
  { id: 'family', label: '家族', icon: 'users', color: '#e56b3f' },
  { id: 'challenge', label: '挑戦', icon: 'mountain', color: '#2878b5' },
  { id: 'learning', label: '学び', icon: 'book-open', color: '#697386' }
];

export const THEORY_OPTIONS = [
  ['cbt', 'CBT'], ['act', 'ACT'], ['adler', 'アドラー心理学'],
  ['positive', 'ポジティブ心理学'], ['coaching', 'コーチング'],
  ['habits', '習慣形成'], ['logical', 'ロジカル思考'],
  ['health', '健康分析'], ['business', '経営分析']
].map(([id, label]) => ({ id, label }));

export const PERSONAS = [
  ['teacher', '先生'], ['friend', '親友'], ['coach', 'コーチ'],
  ['counselor', 'カウンセラー'], ['consultant', '経営コンサル'],
  ['medical_support', '医療サポーター']
].map(([id, label]) => ({ id, label }));

export function uid(prefix = 'rec') {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function isoNow() { return new Date().toISOString(); }

export function createEmptyState() {
  const now = isoNow();
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { id: uid('state'), revision: 0, createdAt: now, updatedAt: now, lastSyncedAt: null },
    profile: {
      id: 'profile_main', name: '', birthDate: '', age: '', location: '', family: '',
      medicalHistory: '', likes: '', strengths: '', workHistory: '', trauma: '',
      values: '', personality: '', constraints: '', supportNeeds: '', satisfaction: '', notes: '',
      fieldUpdatedAt: {}, updatedAt: now
    },
    scores: Object.fromEntries(DOMAINS.map(d => [d.id, 50])),
    scoreUpdatedAt: {},
    scoreNotes: {},
    records: [],
    goals: [],
    habits: [],
    healthItems: [],
    timeline: [],
    comparisons: [],
    products: [],
    reviews: [],
    simulations: [],
    aiHistory: [],
    settings: {
      persona: 'coach', provider: 'gemini',
      theories: Object.fromEntries(THEORY_OPTIONS.map(t => [t.id, true])),
      gasUrl: '', syncToken: '', syncEnabled: false, autoSync: true,
      theme: 'light', fontScale: 1,
      installPromptDismissed: false
    }
  };
}

export function normalizeRecord(input = {}, kind = 'record') {
  const now = isoNow();
  const validDateTime = value => typeof value === 'string' && value.trim() && !Number.isNaN(Date.parse(value));
  const createdAt = validDateTime(input.createdAt) ? String(input.createdAt)
    : (validDateTime(input.updatedAt) ? String(input.updatedAt) : now);
  const updatedAt = validDateTime(input.updatedAt) ? String(input.updatedAt) : createdAt;
  const requestedDate = String(input.date || input.eventDate || '').slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : createdAt.slice(0, 10);
  const tags = Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean)
    : String(input.tags || '').split(/[,、\n]/).map(x => x.trim()).filter(Boolean);
  const details = input.details && typeof input.details === 'object' ? input.details : {};
  return {
    id: String(input.id || uid(kind)), kind: String(input.kind || kind),
    domain: String(input.domain || input.section || 'happiness'),
    title: String(input.title || input.name || input.category || '名称未設定'),
    body: String(input.body || input.content || input.text || input.memo || ''),
    status: String(input.status || 'active'), tags,
    date,
    value: Number.isFinite(Number(input.value)) ? Number(input.value) : null,
    createdAt, updatedAt,
    deletedAt: input.deletedAt || null,
    source: String(input.source || 'life-compass-ai-os'),
    details,
    legacy: input.legacy || null
  };
}

export function normalizeState(raw = {}) {
  const base = createEmptyState();
  const state = {
    ...base, ...raw,
    meta: { ...base.meta, ...(raw.meta || {}) },
    profile: { ...base.profile, ...(raw.profile || {}) },
    scores: { ...base.scores, ...(raw.scores || {}) },
    scoreUpdatedAt: { ...base.scoreUpdatedAt, ...(raw.scoreUpdatedAt || {}) },
    scoreNotes: { ...base.scoreNotes, ...(raw.scoreNotes || {}) },
    settings: {
      ...base.settings, ...(raw.settings || {}),
      theories: { ...base.settings.theories, ...(raw.settings?.theories || {}) }
    }
  };
  state.profile.fieldUpdatedAt = { ...base.profile.fieldUpdatedAt, ...(raw.profile?.fieldUpdatedAt || {}) };
  if (!Object.prototype.hasOwnProperty.call(raw, 'scoreUpdatedAt') && raw.scores) {
    const legacyScoreTime = raw.meta?.updatedAt || isoNow();
    state.scoreUpdatedAt = Object.fromEntries(Object.keys(raw.scores).map(key => [key, legacyScoreTime]));
  }
  for (const key of ['records','goals','habits','healthItems','timeline','comparisons','products','reviews','simulations']) {
    state[key] = Array.isArray(raw[key]) ? raw[key].map(x => normalizeRecord(x, key.replace(/s$/, ''))) : [];
  }
  state.aiHistory = Array.isArray(raw.aiHistory) ? raw.aiHistory.slice(-100) : [];
  state.schemaVersion = SCHEMA_VERSION;
  return state;
}

export function touchState(state) {
  return { ...state, meta: { ...state.meta, revision: Number(state.meta.revision || 0) + 1, updatedAt: isoNow() } };
}

export function calculateLifeScore(state) {
  const values = DOMAINS.map(d => Number(state.scores[d.id] ?? 50));
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export function todayTasks(state) {
  const today = localDateKey();
  return [...state.goals, ...state.habits, ...state.records]
    .filter(x => !x.deletedAt && x.status !== 'done' && (
      x.date === today || x.kind === 'habit' || x.details?.dueDate === today
    ))
    .slice(0, 6);
}

export function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function activeRows(rows = []) {
  return rows.filter(row => !row.deletedAt);
}

export function reviewDue(state, period, now = new Date()) {
  const days = { weekly: 7, monthly: 30, yearly: 365 };
  const last = activeRows(state.reviews)
    .filter(row => row.details?.period === period)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (!last) return true;
  return (now - new Date(last.createdAt)) / 86400000 >= days[period];
}
