import { DOMAINS, isoNow } from './model.js';

export const DATA_SCOPE_OPTIONS = [
  ['basicProfile', '基本プロフィール', '名前・年齢・性格・現在の満足度'],
  ['values', '価値観・強み', '価値観・好きなこと・強み・実績'],
  ['work', '仕事・経歴', '仕事歴と仕事分野の記録'],
  ['goals', '目標', '期限・進捗・優先度'],
  ['priorityIssues', '最優先課題', '急な問題・重要課題・期限・対応順'],
  ['futureLife', 'これから作る理想の人生', '80歳を仮の時間軸にした未来の方向性・理想像・ギャップ'],
  ['habits', '習慣', '習慣と継続基準'],
  ['wishes', '夢・楽しみ', '欲しいもの・場所・挑戦・体験'],
  ['scores', '人生レーダー', '8分野の現在点'],
  ['recentRecords', '最近の記録', '日々の気づき・出来事'],
  ['timeline', '人生タイムライン', '転機と価値観の変化'],
  ['products', '商品・事業', 'WEBRICHや商品アイデア'],
  ['reviews', '振り返り', '複数分野を含む週間・月間・年間レビュー（慎重）'],
  ['health', '健康・病歴', '既往歴・症状・受診準備（慎重）'],
  ['family', '家族情報', '家族構成や家族に関する記録（慎重）'],
  ['location', '住所・地域', '住まい・地域情報（慎重）'],
  ['finance', '収入・金銭', '収入分野の記録・点数（慎重）'],
  ['aiHistory', 'AI相談履歴', '過去の質問と回答（慎重）']
].map(([id, label, description]) => ({ id, label, description }));

const active = rows => (rows || []).filter(row => !row.deletedAt);
const takeLast = (rows, count) => active(rows).slice(-count);

function allowedByDomain(row = {}, scopes = {}) {
  const domain = String(row.domain || '');
  if (domain === 'health' && !scopes.health) return false;
  if (domain === 'family' && !scopes.family) return false;
  if (domain === 'income' && !scopes.finance) return false;
  return true;
}

function takeAllowed(rows, count, scopes) {
  return active(rows).filter(row => allowedByDomain(row, scopes)).slice(-count);
}

function sanitizeProfile(profile = {}, scopes = {}) {
  const out = {};
  if (scopes.basicProfile) {
    for (const key of ['name', 'age', 'personality', 'satisfaction']) {
      if (profile[key]) out[key] = profile[key];
    }
  }
  if (scopes.values) {
    for (const key of ['likes', 'strengths', 'values']) if (profile[key]) out[key] = profile[key];
  }
  if (scopes.work && profile.workHistory) out.workHistory = profile.workHistory;
  if (scopes.health) {
    for (const key of ['medicalHistory', 'constraints', 'supportNeeds', 'trauma']) {
      if (profile[key]) out[key] = profile[key];
    }
  }
  if (scopes.family && profile.family) out.family = profile.family;
  if (scopes.location && profile.location) out.location = profile.location;
  return out;
}

function domainRows(rows, allowedDomains) {
  return takeLast(rows, 30).filter(row => allowedDomains.includes(row.domain));
}

export function buildScopedContext(state, scopes = {}) {
  const context = {
    generatedAt: isoNow(),
    profile: sanitizeProfile(state.profile, scopes)
  };
  if (scopes.scores) {
    const allowedDomains = DOMAINS.filter(domain => allowedByDomain({ domain:domain.id }, scopes));
    context.scores = Object.fromEntries(allowedDomains
      .map(domain => [domain.id, state.scores[domain.id] ?? 50]));
    const allowedValues = Object.values(context.scores).map(Number).filter(Number.isFinite);
    context.lifeScore = allowedValues.length
      ? Math.round(allowedValues.reduce((sum, value) => sum + value, 0) / allowedValues.length)
      : null;
  }
  if (scopes.goals) context.goals = takeAllowed(state.goals, 30, scopes);
  if (scopes.futureLife) context.futureLife = takeAllowed(state.futureVisions, 60, scopes);
  if (scopes.priorityIssues) context.priorityIssues = takeAllowed((state.records || []).filter(row => row.kind === 'priorityIssue'), 30, scopes);
  if (scopes.habits) context.habits = takeAllowed(state.habits, 30, scopes);
  if (scopes.wishes) context.wishes = takeAllowed(state.wishes, 40, scopes);
  if (scopes.timeline) context.timeline = takeAllowed(state.timeline, 60, scopes);
  if (scopes.products) context.products = takeAllowed(state.products, 30, scopes);
  if (scopes.reviews) context.reviews = takeAllowed(state.reviews, 20, scopes);
  if (scopes.health) context.health = takeLast(state.healthItems, 30);
  if (scopes.recentRecords) {
    context.recentRecords = takeAllowed(state.records, 30, scopes);
  }
  if (scopes.work) context.workRecords = domainRows(state.records, ['work']);
  if (scopes.family) context.familyRecords = domainRows(state.records, ['family']);
  if (scopes.finance) {
    context.financeRecords = takeLast((state.records || []).filter(row => ['incomeRecord','expenseRecord','fixedCostRecord','debtRecord'].includes(row.kind) || row.domain === 'income'), 100);
    context.incomeRecords = context.financeRecords.filter(row => row.kind === 'incomeRecord' || (!['expenseRecord','fixedCostRecord','debtRecord'].includes(row.kind) && row.domain === 'income'));
  }
  if (scopes.aiHistory) context.aiHistory = (state.aiHistory || []).slice(-30);
  return context;
}

function humanValue(value) {
  if (value == null || value === '') return '';
  if (Array.isArray(value)) return value.join('、');
  if (typeof value === 'object') return Object.entries(value)
    .filter(([, item]) => item != null && item !== '' && !Array.isArray(item))
    .map(([key, item]) => `${key}: ${item}`).join('／');
  return String(value);
}

export function buildCloneKnowledgeMarkdown(state, scopes) {
  const context = buildScopedContext(state, scopes);
  const lines = [
    '# Life Compass｜相棒専用GPT 知識資料', '',
    `作成日時: ${new Date().toLocaleString('ja-JP')}`, '',
    '> この資料は非公開GPT専用です。許可した範囲だけを収録しています。',
    '> 最新情報はLife Compassを正本とし、このファイルは作成時点のスナップショットです。', ''
  ];
  const labels = {
    profile: 'プロフィール', scores: '人生レーダー', goals: '目標', futureLife: 'これから作る理想の人生', habits: '習慣',
    wishes: '夢・楽しみ', timeline: '人生タイムライン', products: '商品・事業',
    reviews: '定期レビュー', health: '健康・受診準備', priorityIssues: '最優先課題', recentRecords: '最近の記録',
    workRecords: '仕事の記録', familyRecords: '家族の記録', incomeRecords: '収入の記録', financeRecords: 'お金の記録（収入・支出・固定費・負債）',
    aiHistory: 'AI相談履歴'
  };
  for (const [key, value] of Object.entries(context)) {
    if (key === 'generatedAt' || key === 'lifeScore' || value == null) continue;
    lines.push(`## ${labels[key] || key}`);
    if (Array.isArray(value)) {
      if (!value.length) lines.push('- 登録なし');
      for (const row of value) {
        lines.push(`### ${row.date || ''} ${row.title || row.question || '記録'}`.trim());
        if (row.body || row.answer) lines.push(String(row.body || row.answer));
        const detail = humanValue(row.details);
        if (detail) lines.push(`- 詳細: ${detail}`);
        if (row.status) lines.push(`- 状態: ${row.status}`);
      }
    } else {
      for (const [itemKey, itemValue] of Object.entries(value)) {
        const text = humanValue(itemValue);
        if (text) lines.push(`- ${itemKey}: ${text}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function buildCloneInstructions() {
  return `あなたは、Life Compassに蓄積された本人の事実・経験・価値観を参照する非公開の専用伴走AIです。

【役割】
- 本人の価値観と現実の制約を尊重し、人生・健康・仕事・収入・商品開発を横断して考える。
- 本人の口調を単純にまねるのではなく、判断の補助と第二の脳として機能する。

【回答ルール】
1. 「登録データにある事実」「推測」「改善案」を混ぜない。
2. 利用者が期待している結論に合わせるために分析結果を変えない。良いものは根拠とともに良いと評価し、問題があるもの・現実性が低いもの・負担が大きいものは理由を明確に指摘する。
3. 本人の希望と客観的分析が一致しない場合は、その違いを明示する。判断材料が足りない場合は無理に結論を出さず「判断材料不足」とする。
4. 最優先課題・期限・安全・生活維持を確認し、夢や長期目標とのバランスを取る。
5. 優先順位は多くても3つ、最後に今日始められる一歩を1つ示す。
6. 医療診断・投薬指示を行わず、危険性がある場合は医療機関への相談を促す。
7. 未来を断定せず、条件付きの可能性として説明する。
8. 家族・健康・金銭・住所などの情報を外部共有用の文章へ無断で含めない。
9. Life Compassが正本であり、知識ファイルは作成日時点の情報だと認識する。

【標準の回答構成】
- 結論
- 根拠となる登録事実
- 推測・注意点
- 優先順位
- 今日の一歩`;
}

export function buildActionsOpenApiTemplate() {
  return {
    openapi: '3.1.0',
    info: { title: 'Life Compass Secure Context API', version: '1.0.0' },
    servers: [{ url: 'https://YOUR-SECURE-ENDPOINT.example.com' }],
    paths: {
      '/life-compass/context': {
        post: {
          operationId: 'getLifeCompassContext',
          summary: '質問に必要な許可済みLife Compassデータを取得する',
          security: [{ LifeCompassApiKey: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: {
              type: 'object', properties: {
                question: { type: 'string', description: '本人の相談内容' },
                purpose: { type: 'string', enum: ['daily', 'health', 'business', 'review'] }
              }, required: ['question']
            } } }
          },
          responses: { '200': { description: '許可範囲に限定した本人データ' } }
        }
      }
    },
    components: { securitySchemes: {
      LifeCompassApiKey: { type: 'apiKey', in: 'header', name: 'X-Life-Compass-Key' }
    } }
  };
}

export function estimateGeminiCost(config = {}) {
  const questionsPerDay = Math.max(0, Number(config.questionsPerDay || 0));
  const inputTokens = Math.max(0, Number(config.inputTokens || 0));
  const outputTokens = Math.max(0, Number(config.outputTokens || 0));
  const usdJpy = Math.max(0, Number(config.usdJpy || 0));
  const inputRate = Math.max(0, Number(config.geminiInputPerMillionUsd || 0));
  const outputRate = Math.max(0, Number(config.geminiOutputPerMillionUsd || 0));
  const dailyUsd = questionsPerDay * ((inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate);
  return {
    dailyYen: dailyUsd * usdJpy,
    monthlyYen: dailyUsd * 30 * usdJpy,
    yearlyYen: dailyUsd * 365 * usdJpy,
    monthlyQuestions: questionsPerDay * 30
  };
}


export function buildUniversalAIContextMarkdown(state, scopes = {}) {
  const context = buildScopedContext(state, scopes);
  const lines = [
    '# Life Compass｜Universal AI Context Pack', '',
    `生成日時: ${new Date().toLocaleString('ja-JP')}`, '',
    '## このファイルの役割',
    '- Life Compassを本人情報の正本（メインの頭脳）とし、他のAIへ必要な背景を安全に渡すための可搬コンテキストです。',
    '- 80歳は寿命予測ではなく、これからの人生を楽しみながら理想へ近づけるための仮の計画時間軸です。',
    '- 理想は「達成できた／できない」だけで判定せず、現在の選択が理想の方向へ近づいているかを重視してください。',
    '- 登録事実・本人の希望・AIの推測を区別し、本人が望む結論へ忖度しないでください。',
    '- 最優先課題、健康・医療、お金、期限、安全を無視して夢だけを肯定しないでください。', '',
    '## AIへの共通指示',
    '1. 良いものは根拠を示して良いと評価し、悪いもの・現実性が低いものは理由を明確に指摘する。',
    '2. 「理想の未来」と「欲しいもの・行きたい場所・やりたいこと・目標・行動」の方向性が合っているか確認する。',
    '3. 完全実現が難しい場合でも、何割・どの部分なら近づけるか、代替案と次の一歩を示す。',
    '4. 年齢・健康・医療・収入・固定費・負債・家族・時間を現実条件として扱う。',
    '5. 判断材料が不足している場合は「判断材料不足」と明示する。', '',
    buildCloneKnowledgeMarkdown(state, scopes)
  ];
  return lines.join('\n');
}

export function buildUniversalAIContextJson(state, scopes = {}) {
  return {
    format: 'LifeCompassUniversalAIContext',
    version: '1.0',
    generatedAt: isoNow(),
    sourceOfTruth: 'Life Compass AI OS',
    planningHorizon: {
      horizonAge: 80,
      meaning: '寿命予測ではなく、理想へ近づき人生を楽しむための仮の計画時間軸'
    },
    aiRules: {
      noSycophancy: true,
      separateFactsHopesAndInference: true,
      realityBeforeWishfulThinking: true,
      checkAlignmentWithIdealFuture: true,
      offerPartialAndAlternativePaths: true,
      sayInsufficientEvidenceWhenNeeded: true
    },
    context: buildScopedContext(state, scopes)
  };
}

export function buildUniversalAIStarterPrompt() {
  return `添付した「Life Compass Universal AI Context Pack」を、私に関する現在の正本コンテキストとして参照してください。\n\n回答では、登録された事実・私の希望・あなたの推測を区別してください。私が望みそうな結論へ寄せず、良いものは根拠とともに良い、問題があるものは理由とともに問題があると評価してください。\n\n特に「これから作る理想の人生」を方向の基準にしつつ、最優先課題、年齢、健康・医療、収入・支出・固定費・負債、家族、期限を現実条件として同時に見てください。80歳は寿命予測ではなく計画上の仮の時間軸です。完全実現が難しい場合は、理想を捨てるのではなく、近づける部分・代替案・今やる一歩を示してください。`;
}
