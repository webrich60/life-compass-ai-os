import { DOMAINS, THEORY_OPTIONS, PERSONAS, calculateLifeScore, isoNow, uid } from './model.js';

export function buildContext(state) {
  return {
    profile: state.profile,
    lifeScore: calculateLifeScore(state), scores: state.scores,
    goals: state.goals.filter(x => !x.deletedAt).slice(-20),
    habits: state.habits.filter(x => !x.deletedAt).slice(-20),
    health: state.healthItems.filter(x => !x.deletedAt).slice(-20),
    recentRecords: state.records.filter(x => !x.deletedAt).slice(-30),
    timeline: state.timeline.filter(x => !x.deletedAt).slice(-40),
    comparisons: state.comparisons.filter(x => !x.deletedAt).slice(-10),
    products: state.products.filter(x => !x.deletedAt).slice(-20),
    reviews: state.reviews.filter(x => !x.deletedAt).slice(-12),
    simulations: state.simulations.filter(x => !x.deletedAt).slice(-10)
  };
}

export function buildAnalysisRequest(state, question, mode = 'cross') {
  const enabled = THEORY_OPTIONS.filter(t => state.settings.theories[t.id]).map(t => t.label);
  const persona = PERSONAS.find(p => p.id === state.settings.persona)?.label || 'コーチ';
  return {
    action: 'ai', token: state.settings.syncToken, provider: state.settings.provider, mode, question,
    persona, theories: enabled, context: buildContext(state),
    guardrails: {
      structure: ['事実','推測','改善案','優先順位','今日の一歩'],
      medicalDiagnosis: false,
      simulationNotPrediction: true,
      avoidOverconfidence: true
    }
  };
}

export async function askAI(state, question, mode = 'cross') {
  if (!state.settings.gasUrl) throw new Error('設定画面でGAS同期URLを登録してください');
  if (!state.settings.syncToken) throw new Error('設定画面で同期トークンを登録してください');
  const payload = buildAnalysisRequest(state, question, mode);
  const res = await fetch(state.settings.gasUrl, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload), redirect: 'follow'
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'AI分析に失敗しました');
  return { id: uid('ai'), question, answer: json.answer, mode, provider: payload.provider,
    persona: payload.persona, theories: payload.theories, createdAt: isoNow() };
}

export function buildNotebookMarkdown(state) {
  const lines = ['# Life Compass AI OS｜人生データ', '', `出力日時: ${new Date().toLocaleString('ja-JP')}`, ''];
  lines.push('## プロフィール');
  for (const [k,v] of Object.entries(state.profile)) if (v && !['id','updatedAt'].includes(k)) lines.push(`- ${k}: ${v}`);
  lines.push('', '## 人生レーダー');
  for (const d of DOMAINS) lines.push(`- ${d.label}: ${state.scores[d.id] ?? 50}/100`);
  const sections = [['目標',state.goals],['習慣',state.habits],['健康',state.healthItems],['人生比較',state.comparisons],['人生タイムライン',state.timeline],['商品・事業',state.products],['定期レビュー',state.reviews],['未来シミュレーション',state.simulations],['記録',state.records]];
  for (const [label,rows] of sections) {
    lines.push('', `## ${label}`);
    for (const r of rows.filter(x => !x.deletedAt)) {
      lines.push(`### ${r.date || ''} ${r.title}\n${r.body || ''}`);
      const details = Object.entries(r.details || {}).filter(([, value]) => value && !Array.isArray(value));
      for (const [key, value] of details) lines.push(`- ${key}: ${value}`);
    }
  }
  return lines.join('\n');
}
