const GENERIC_TERMS = new Set([
  '健康','仕事','収入','自由','幸福','家族','挑戦','学び','目標','習慣','記録','メモ','欲しい','欲しいもの',
  '行きたい','行きたい場所','やりたい','やってみたい','体験','旅行','購入','検討','計画','いつか','実現','商品','事業'
]);

export function normalizeDuplicateText(value = '') {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\s　・･,，、。.!！?？:：;；()（）\[\]【】「」『』<>＜＞\-_ー~〜/\\]+/g, '')
    .replace(/(が欲しい|を欲しい|ほしい|欲しいです|に行きたい|へ行きたい|行ってみたい|をやりたい|してみたい|やってみたい)$/g, '');
}

function cleanTerm(value = '') {
  const normalized = normalizeDuplicateText(value);
  return normalized.length >= 2 && !GENERIC_TERMS.has(normalized) ? normalized : '';
}

export function extractDuplicateTerms(record = {}) {
  const terms = new Set();
  const title = cleanTerm(record.title);
  if (title) terms.add(title);
  const tags = Array.isArray(record.tags) ? record.tags : String(record.tags || '').split(/[,、\n]/);
  for (const tag of tags) {
    const term = cleanTerm(tag);
    if (term) terms.add(term);
  }
  return [...terms];
}

function bigrams(text = '') {
  const normalized = normalizeDuplicateText(text);
  if (normalized.length < 2) return normalized ? [normalized] : [];
  const grams = [];
  for (let i = 0; i < normalized.length - 1; i += 1) grams.push(normalized.slice(i, i + 2));
  return grams;
}

export function diceSimilarity(a = '', b = '') {
  const aa = bigrams(a);
  const bb = bigrams(b);
  if (!aa.length || !bb.length) return 0;
  const counts = new Map();
  for (const gram of aa) counts.set(gram, (counts.get(gram) || 0) + 1);
  let overlap = 0;
  for (const gram of bb) {
    const count = counts.get(gram) || 0;
    if (count > 0) {
      overlap += 1;
      counts.set(gram, count - 1);
    }
  }
  return (2 * overlap) / (aa.length + bb.length);
}

function sameScope(a = {}, b = {}, kind = '') {
  if (kind !== 'wish') return true;
  const fallback = '欲しいもの';
  return (a.details?.wishType || fallback) === (b.details?.wishType || fallback);
}

export function compareDuplicateRecords(candidate = {}, existing = {}, kind = '') {
  if (!candidate || !existing || !sameScope(candidate, existing, kind)) return null;
  const reasons = [];
  let score = 0;
  const aTitle = normalizeDuplicateText(candidate.title);
  const bTitle = normalizeDuplicateText(existing.title);
  const aText = normalizeDuplicateText(`${candidate.title || ''} ${candidate.body || ''}`);
  const bText = normalizeDuplicateText(`${existing.title || ''} ${existing.body || ''}`);

  if (aTitle && bTitle && aTitle === bTitle) {
    score = 100;
    reasons.push('タイトルが同じ');
  } else if (aTitle.length >= 4 && bTitle.length >= 4 && (aTitle.includes(bTitle) || bTitle.includes(aTitle))) {
    score = Math.max(score, 94);
    reasons.push('タイトルの主要語が重なる');
  } else {
    const similarity = diceSimilarity(aTitle, bTitle);
    if (Math.min(aTitle.length, bTitle.length) >= 4 && similarity >= 0.78) {
      score = Math.max(score, Math.round(78 + similarity * 16));
      reasons.push('タイトルがよく似ている');
    }
  }

  const aTerms = extractDuplicateTerms(candidate);
  const bTerms = extractDuplicateTerms(existing);
  const sharedTags = aTerms.filter(term => bTerms.includes(term));
  if (sharedTags.length) {
    score = Math.max(score, 88);
    reasons.push(`同じタグ・キーワード「${sharedTags[0]}」`);
  }

  const phraseMatches = aTerms.filter(term => term.length >= 3 && bText.includes(term));
  const reverseMatches = bTerms.filter(term => term.length >= 3 && aText.includes(term));
  const phrase = phraseMatches[0] || reverseMatches[0];
  if (phrase) {
    score = Math.max(score, 84);
    if (!reasons.some(reason => reason.includes(phrase))) reasons.push(`共通キーワード「${phrase}」`);
  }

  if (score < 84) return null;
  return { score, reasons: [...new Set(reasons)] };
}

export function findDuplicateCandidates(rows = [], candidate = {}, kind = '', excludeId = '') {
  return rows
    .filter(row => row && !row.deletedAt && row.id !== excludeId)
    .map(row => {
      const match = compareDuplicateRecords(candidate, row, kind);
      return match ? { row, ...match } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || String(a.row.title).localeCompare(String(b.row.title), 'ja'));
}

export function findDuplicatePairs(rows = [], kind = '') {
  const active = rows.filter(row => row && !row.deletedAt);
  const pairs = [];
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const match = compareDuplicateRecords(active[i], active[j], kind);
      if (match) pairs.push({ first: active[i], second: active[j], ...match });
    }
  }
  return pairs.sort((a, b) => b.score - a.score);
}
