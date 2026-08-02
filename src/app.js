import {
  DOMAINS, THEORY_OPTIONS, PERSONAS, WISH_TYPES, EXPERIENCE_TYPES, createEmptyState, normalizeRecord,
  calculateLifeScore, todayTasks, isoNow, localDateKey, activeRows, reviewDue
} from './model.js';
import {
  CACHE_KEY, SETTINGS_KEY, loadCache, saveCache, exportBackup, synchronize,
  testConnection, uploadAttachment
} from './storage.js';
import { inspectLegacyJson, applyMigration, inspectLegacyJsonBatch, applyMigrationBatch } from './migration.js';
import { askAI, buildNotebookMarkdown } from './ai.js';
import {
  DATA_SCOPE_OPTIONS, buildCloneKnowledgeMarkdown, buildCloneInstructions,
  buildActionsOpenApiTemplate, estimateGeminiCost
} from './integrations.js';

const PAGES = [
  ['home','⌂','ホーム'], ['life','◎','人生設計'], ['health','♡','健康'],
  ['work','▣','仕事・収入'], ['timeline','⌁','タイムライン'], ['reviews','◷','定期レビュー'],
  ['ai','✦','AI伴走'], ['integrations','⌬','AI連携'], ['data','⇄','連携・移行'], ['profile','♙','プロフィール']
];
const EXTRA_PAGES = ['settings','search'];
const MOBILE = ['home','life','health','ai','data'];
const COLLECTIONS = {
  record:'records', goal:'goals', habit:'habits', healthItem:'healthItems',
  wish:'wishes', timeline:'timeline', comparison:'comparisons', product:'products', review:'reviews', simulation:'simulations'
};
const KIND_LABELS = {
  record:'日々の記録', goal:'目標', habit:'習慣', healthItem:'健康項目', timeline:'人生の出来事',
  wish:'夢・楽しみ', comparison:'人生比較', product:'商品・事業の種', review:'定期レビュー', simulation:'未来シミュレーション'
};
const DETAIL_FIELDS = {
  record:[['mood','気分（任意）','text'],['energy','エネルギー 0〜100','number']],
  goal:[['dueDate','期限','date'],['priority','優先度','select','高|中|低'],['progress','進捗 0〜100','number']],
  habit:[['frequency','頻度','select','毎日|週1回|週2回|週3回|平日|自由設定'],['target','続ける基準','text']],
  wish:[
    ['wishType','種類','select',WISH_TYPES.join('|')],
    ['experienceType','挑戦・体験の種類（該当するとき）','select',`|${EXPERIENCE_TYPES.join('|')}`],
    ['targetDate','実現したい時期','date'],
    ['priority','優先度','select','高|中|低'],['budget','予算の目安','text'],
    ['wishStatus','実現状況','select','いつか|検討中|計画中|実現済み'],['reason','実現したい理由','textarea'],
    ['firstStep','最初の一歩','textarea'],['companion','一緒に実現したい人（任意）','text']
  ],
  healthItem:[
    ['history','既往歴・これまで','textarea'],['current','現在の状態','textarea'],['ideal','理想状態','textarea'],
    ['improvements','考えられる改善方法','textarea'],['firstStep','まずやること','textarea'],
    ['ifNoChange','改善しない場合','textarea'],['doctorQuestions','専門医へ相談すること','textarea']
  ],
  comparison:[['pastIdeal','過去の理想','textarea'],['current','現在','textarea'],['newIdeal','新しい理想','textarea'],['gaps','差分・障害','textarea']],
  timeline:[['valueChange','その時に変わった価値観','textarea']],
  product:[['customer','誰のための商品か','text'],['problem','解決する悩み','textarea'],['offer','提供内容','textarea'],['price','想定価格','text'],['nextValidation','次の検証','textarea']],
  review:[['period','期間','select','weekly|monthly|yearly'],['wins','できたこと','textarea'],['issues','課題','textarea'],['nextActions','次にやること','textarea']],
  simulation:[['condition','変える条件','textarea'],['horizon','期間','select','1か月|3か月|半年|1年'],['assumptions','前提条件','textarea']]
};
const DETAIL_LABELS = Object.fromEntries(Object.values(DETAIL_FIELDS).flat().map(([key,label]) => [key,label]));
const PROFILE_FIELDS = [
  ['name','名前','text'],['birthDate','生年月日','date'],['age','年齢','number'],['location','住まい','text'],
  ['family','家族','textarea'],['medicalHistory','既往歴','textarea'],['likes','好きなこと','textarea'],
  ['strengths','強み・実績','textarea'],['workHistory','仕事歴','textarea'],['trauma','苦労・心の傷','textarea'],
  ['values','価値観・信条','textarea'],['personality','性格・自分の傾向','textarea'],
  ['constraints','現在の制約','textarea'],['supportNeeds','必要な支援','textarea'],
  ['satisfaction','現在の満足度','text'],['notes','自由メモ','textarea']
];

let state = loadCache();
let page = location.hash.slice(1) || 'home';
let migrationInspection = null;
let syncTimer = null;
let syncInFlight = false;
let deferredInstallPrompt = null;
let searchKind = 'all';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

function navHtml(keys = PAGES.map(item => item[0])) {
  return PAGES.filter(([id]) => keys.includes(id)).map(([id,icon,label]) =>
    `<button class="nav-link ${page===id?'active':''}" data-page="${id}"><span>${icon}</span><span>${label}</span></button>`).join('');
}

function setPage(next) {
  page = PAGES.some(([id]) => id === next) || EXTRA_PAGES.includes(next) ? next : 'home';
  history.replaceState(null,'',`#${page}`);
  render();
  $('#sidebar').classList.remove('open');
  window.scrollTo({top:0,behavior:'smooth'});
}

function toast(message, type = '') {
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.textContent = message;
  $('#toasts').append(element);
  setTimeout(() => element.remove(), 3800);
}

function commit(next, message = '保存しました', { autoSync = true, rerender = false } = {}) {
  state = saveCache(next);
  updateChrome();
  if (message) toast(message);
  if (autoSync) scheduleAutoSync();
  if (rerender) render();
}

function scheduleAutoSync() {
  clearTimeout(syncTimer);
  if (!state.settings.autoSync || !state.settings.gasUrl || !state.settings.syncToken || !navigator.onLine) return;
  syncTimer = setTimeout(() => performSync({ quiet:true }), 1800);
}

async function performSync({ quiet = false } = {}) {
  if (syncInFlight) return;
  syncInFlight = true;
  updateChrome('syncing');
  try {
    state = await synchronize(state);
    if (!quiet) toast('PC・スマホ・タブレットのデータを安全に統合しました');
  } catch (error) {
    if (!quiet) toast(error.message || String(error),'error');
  } finally {
    syncInFlight = false;
    updateChrome();
    if (!quiet) render();
  }
}

function updateChrome(status = '') {
  const found = PAGES.find(([id]) => id === page);
  const names = { settings:'設定', search:'データ検索' };
  $('#pageTitle').textContent = names[page] || found?.[2] || 'Life Compass';
  $('#avatarText').textContent = (state.profile.name || '相').slice(0,1);
  $('#saveState').textContent = state.meta.lastSyncedAt
    ? `最終同期 ${new Date(state.meta.lastSyncedAt).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}`
    : 'この端末に保存済み';
  document.documentElement.style.setProperty('--font-scale', state.settings.fontScale || 1);
  $('#nav').innerHTML = navHtml();
  $('#mobileNav').innerHTML = navHtml(MOBILE);
  const pill = $('#connectionPill');
  const connected = navigator.onLine && state.settings.gasUrl && state.settings.syncToken;
  pill.className = `connection-pill ${connected?'online':'offline'}`;
  pill.querySelector('span').textContent = status === 'syncing' ? '同期中' : (!navigator.onLine ? 'オフライン' : connected ? '同期接続' : '端末保存');
  const dot = $('#syncDot');
  if (dot) dot.classList.toggle('online', Boolean(connected));
}

function sectionHead(title, sub = '', action = '') {
  return `<div class="section-head"><div><h2>${esc(title)}</h2>${sub?`<p>${esc(sub)}</p>`:''}</div>${action}</div>`;
}

function domainLabel(id) { return DOMAINS.find(domain => domain.id === id)?.label || id || 'その他'; }
function displayDate(value) {
  if (!value) return '日付なし';
  const date = new Date(`${String(value).slice(0,10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? esc(value) : new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'short',day:'numeric'}).format(date);
}
function collectionFor(kind) { return COLLECTIONS[kind]; }
function allRows({ deleted = false } = {}) {
  return Object.entries(COLLECTIONS).flatMap(([kind,key]) => (state[key] || []).map(row => ({...row,kind:row.kind || kind})))
    .filter(row => deleted ? Boolean(row.deletedAt) : !row.deletedAt);
}
function isOverdue(row) {
  const due = row.details?.dueDate || row.date;
  return row.status !== 'done' && due && due < localDateKey();
}

function radarSvg() {
  const cx=180, cy=180, radius=133, count=DOMAINS.length;
  const point=(index,ratio=1)=>{const angle=-Math.PI/2+index*2*Math.PI/count;return `${cx+Math.cos(angle)*radius*ratio},${cy+Math.sin(angle)*radius*ratio}`};
  const grids=[.25,.5,.75,1].map(ratio=>`<polygon points="${DOMAINS.map((_,index)=>point(index,ratio)).join(' ')}" fill="none" stroke="#d6e2f2"/>`).join('');
  const axes=DOMAINS.map((_,index)=>`<line x1="${cx}" y1="${cy}" x2="${point(index).split(',')[0]}" y2="${point(index).split(',')[1]}" stroke="#e2eaf5"/>`).join('');
  const values=DOMAINS.map((domain,index)=>point(index,Math.max(.02,Number(state.scores[domain.id]||0)/100))).join(' ');
  const labels=DOMAINS.map((domain,index)=>{const [x,y]=point(index,1.17).split(',');return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="12" font-weight="700" fill="#26384f">${domain.label}</text>`}).join('');
  return `<svg class="radar" viewBox="0 0 360 360" role="img" aria-label="人生レーダー">${grids}${axes}<polygon points="${values}" fill="rgba(21,88,176,.20)" stroke="#1558b0" stroke-width="3"/>${labels}</svg>`;
}

function taskHtml(row) {
  const overdue = isOverdue(row);
  return `<div class="task ${overdue?'overdue':''}"><button class="task-check" data-action="done" data-kind="${esc(row.kind)}" data-id="${esc(row.id)}" aria-label="完了にする"></button><div class="task-main"><b>${esc(row.title)}</b><small>${overdue?'期限超過：':''}${esc(row.details?.dueDate || row.body || row.date || '')}</small></div><span class="badge">${esc(domainLabel(row.domain))}</span></div>`;
}

function renderHome() {
  const score = calculateLifeScore(state);
  const tasks = todayTasks(state);
  const weakest = [...DOMAINS].sort((a,b) => state.scores[a.id]-state.scores[b.id])[0];
  const overdue = [...state.goals,...state.habits].filter(row => !row.deletedAt && isOverdue(row));
  const reviewNeeded = ['weekly','monthly','yearly'].filter(period => reviewDue(state,period)).length;
  const lastAI = [...state.aiHistory].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];
  return `<div class="page-enter">
    <div class="hero"><div class="hero-grid"><div><span class="badge">TODAY'S COMPASS</span><h2>${esc(state.profile.name || '相棒')}さん、今日を少し前へ。</h2><p>全部を一度に変えなくて大丈夫です。今の人生データから、効果の大きい一歩を選びます。</p><div class="btn-row"><button class="btn" data-page="ai">AIに優先順位を聞く</button><button class="btn secondary" data-action="new-record" data-kind="record">今日を記録</button></div></div><div class="life-score">${score}<small>LIFE SCORE</small></div></div></div>
    ${sectionHead('今日の状態','8つの視点から、今の位置を短時間で確認できます。','<button class="btn ghost" data-page="life">人生レーダーを見る</button>')}
    <div class="grid grid-4">
      <div class="card metric-card"><span class="metric-icon">◎</span><div><small>いまの重点</small><b>${weakest.label}</b></div></div>
      <div class="card metric-card"><span class="metric-icon">✓</span><div><small>今日やること</small><b>${tasks.length}件</b></div></div>
      <div class="card metric-card"><span class="metric-icon">!</span><div><small>期限超過</small><b>${overdue.length}件</b></div></div>
      <div class="card metric-card"><span class="metric-icon">◷</span><div><small>レビュー時期</small><b>${reviewNeeded}件</b></div></div>
    </div>
    ${sectionHead('今日やること','目標・習慣・本日の記録から表示')}
    <div class="grid grid-2"><div class="card">${tasks.length?tasks.map(taskHtml).join(''):`<div class="empty">今日の予定はまだありません<br><button class="btn secondary" data-action="new-record" data-kind="goal">目標を追加</button></div>`}</div>
    <div class="card ai-box"><span class="badge blue">AI COMPASS</span><h2>今日の問い</h2><p>いま一番変えると、人生全体に良い影響が広がるものは何か？</p><button class="btn" data-action="quick-ai">横断分析する</button>${lastAI?`<p class="ai-result">${esc(lastAI.answer).slice(0,340)}${lastAI.answer.length>340?'…':''}</p>`:'<div class="empty">最初の横断分析を行うと、ここに要点が表示されます。</div>'}</div></div>
    ${sectionHead('すぐに記録')}
    <div class="quick-actions"><button class="quick" data-action="new-record" data-kind="record"><b>＋ 日々の記録</b><small>気づき・感情・出来事</small></button><button class="quick" data-action="new-record" data-kind="healthItem"><b>＋ 健康</b><small>症状・通院・測定</small></button><button class="quick" data-action="new-record" data-kind="goal"><b>＋ 目標</b><small>理想への次の一歩</small></button><button class="quick" data-action="new-record" data-kind="wish"><b>＋ 夢・楽しみ</b><small>もの・場所・挑戦・体験</small></button><button class="quick" data-action="new-record" data-kind="product"><b>＋ 商品・事業</b><small>WEBRICHの種</small></button></div>
  </div>`;
}

function renderLife() {
  const wantedItems = activeRows(state.wishes).filter(row => (row.details?.wishType || '欲しいもの') === '欲しいもの');
  const wantedPlaces = activeRows(state.wishes).filter(row => row.details?.wishType === '行きたい場所');
  const wantedExperiences = activeRows(state.wishes).filter(row => row.details?.wishType === 'やってみたいこと・挑戦・体験');
  return `<div class="page-enter">${sectionHead('人生レーダー','点数は評価ではなく、今の位置と変化を見つける目印です。','<button class="btn" data-action="save-scores">点数を保存</button>')}
  <div class="card radar-wrap">${radarSvg()}<div class="score-editor">${DOMAINS.map(domain=>`<div class="score-row"><label>${domain.label}</label><input type="range" min="0" max="100" value="${state.scores[domain.id]}" data-score="${domain.id}"><output>${state.scores[domain.id]}</output></div>`).join('')}</div></div>
  ${sectionHead('理想との比較','過去の理想 → 現在 → 新しい理想を専用項目で整理','<button class="btn secondary" data-action="new-record" data-kind="comparison">＋ 比較を追加</button>')}${recordList(state.comparisons,'comparison')}
  ${sectionHead('目標と習慣','期限・進捗・頻度まで管理','<div class="btn-row"><button class="btn secondary" data-action="new-record" data-kind="goal">＋ 目標</button><button class="btn secondary" data-action="new-record" data-kind="habit">＋ 習慣</button></div>')}
  <div class="grid grid-2"><div class="card"><h3>目標</h3>${activeRows(state.goals).map(taskHtml).join('')||'<div class="empty">目標はまだありません</div>'}</div><div class="card"><h3>習慣</h3>${activeRows(state.habits).map(taskHtml).join('')||'<div class="empty">習慣はまだありません</div>'}</div></div>
  ${sectionHead('夢・楽しみ','達成義務ではなく、これから叶えたいことを集める場所です。','<button class="btn secondary" data-action="new-record" data-kind="wish">＋ 夢・楽しみを追加</button>')}
  <div class="grid grid-3 wish-grid"><section class="wish-group"><h3>欲しいもの</h3><p>手に入れたい物や暮らしの道具</p>${wantedItems.length?`<div class="record-list">${wantedItems.map(row=>recordCard(row,'wish')).join('')}</div>`:'<div class="empty">欲しいものはまだありません</div>'}</section><section class="wish-group"><h3>行きたい場所</h3><p>旅先、店、施設、訪れたい地域</p>${wantedPlaces.length?`<div class="record-list">${wantedPlaces.map(row=>recordCard(row,'wish')).join('')}</div>`:'<div class="empty">行きたい場所はまだありません</div>'}</section><section class="wish-group"><h3>やってみたいこと・挑戦・体験</h3><p>成長のための挑戦から、純粋に楽しむ体験まで</p>${wantedExperiences.length?`<div class="record-list">${wantedExperiences.map(row=>recordCard(row,'wish')).join('')}</div>`:'<div class="empty">やってみたいことはまだありません</div>'}</section></div></div>`;
}

function renderHealth() {
  return `<div class="page-enter"><div class="hero"><div class="hero-grid"><div><span class="badge">HEALTH COMPASS</span><h2>診断ではなく、整理と受診準備を。</h2><p>既往歴・現在・理想・改善方法・まずやること・改善しない場合・専門医への相談事項を一本の流れで管理します。</p><button class="btn secondary" data-action="new-record" data-kind="healthItem">健康項目を追加</button></div><div class="life-score">${state.scores.health}<small>HEALTH</small></div></div></div>
  ${sectionHead('健康項目','視力・腰痛・血圧などを項目別に管理')}${recordList(state.healthItems,'healthItem')}
  ${sectionHead('健康AIサポート','医療診断は行いません。緊急性がある症状は医療機関へ。')}${aiComposer('health','現在の健康課題を整理し、改善方法・まずやること・改善しない場合・専門医への相談事項を分けてください。')}</div>`;
}

function renderWork() {
  return `<div class="page-enter"><div class="grid grid-3"><div class="card metric-card"><span class="metric-icon">▣</span><div><small>仕事</small><b>${state.scores.work}</b></div></div><div class="card metric-card"><span class="metric-icon">¥</span><div><small>収入</small><b>${state.scores.income}</b></div></div><div class="card metric-card"><span class="metric-icon">◇</span><div><small>自由</small><b>${state.scores.freedom}</b></div></div></div>
  ${sectionHead('商品・事業の種','人生経験をWEBRICHの商品へつなげる','<button class="btn" data-action="new-record" data-kind="product">＋ アイデア追加</button>')}${recordList(state.products,'product')}
  ${sectionHead('経営・商品AI','実用性・販売可能性・次の検証まで客観的に分析')}${aiComposer('business','人生経験と現在の商品案を横断し、実用性・販売可能性・次の検証を客観的に分析してください。')}</div>`;
}

function renderTimeline() {
  return `<div class="page-enter">${sectionHead('AI人生タイムライン','出来事と価値観の変化を一本の線で見る','<button class="btn" data-action="new-record" data-kind="timeline">＋ 出来事を追加</button>')}<div class="timeline">${recordList([...state.timeline].sort((a,b)=>a.date.localeCompare(b.date)),'timeline',false)}</div>
  ${sectionHead('タイムライン分析','転機・繰り返すパターン・強みを抽出')}${aiComposer('timeline','人生タイムラインから転機、価値観の変化、繰り返すパターン、活かせる強みを整理してください。')}</div>`;
}

function renderReviews() {
  const periods = [['weekly','週間','この1週間'],['monthly','月間','この1か月'],['yearly','年間','この1年']];
  return `<div class="page-enter"><div class="hero"><div class="hero-grid"><div><span class="badge">LIFE REVIEW</span><h2>記録を、次の一歩へ変える。</h2><p>毎週・毎月・毎年の変化をAIと振り返り、できたこと・課題・次の行動を残します。</p></div><div class="life-score">◷<small>REVIEW</small></div></div></div>
  ${sectionHead('定期レビュー','時期が来たものから一つずつ作成できます。')}
  <div class="grid grid-3">${periods.map(([id,label,range])=>{const due=reviewDue(state,id);return `<article class="card review-card"><span class="badge ${due?'warn':''}">${due?'作成時期です':'作成済み'}</span><div class="review-state">${label}</div><p>${range}の記録・目標・健康・スコアを横断します。</p><button class="btn ${due?'':'secondary'}" data-action="generate-review" data-period="${id}">${due?'AIレビューを作る':'もう一度作る'}</button></article>`}).join('')}</div>
  ${sectionHead('レビュー履歴','手動で補足することもできます。','<button class="btn secondary" data-action="new-record" data-kind="review">＋ 手動レビュー</button>')}${recordList([...state.reviews].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)),'review')}</div>`;
}

function aiComposer(mode, preset='') {
  return `<div class="card ai-box"><div class="form-grid"><div class="field"><label>AI人格</label><select data-setting="persona">${PERSONAS.map(persona=>`<option value="${persona.id}" ${state.settings.persona===persona.id?'selected':''}>${persona.label}</option>`).join('')}</select></div><div class="field"><label>AIモデル</label><select data-setting="provider"><option value="gemini" ${state.settings.provider==='gemini'?'selected':''}>Gemini 2.5 Flash</option><option value="openai" ${state.settings.provider==='openai'?'selected':''}>ChatGPT GPT-5.4 mini</option></select></div><div class="field full"><label>相談・分析したいこと</label><textarea id="aiQuestion-${mode}">${esc(preset)}</textarea></div></div><button class="btn" data-action="ask-ai" data-mode="${mode}">AIに分析してもらう</button><div class="ai-result" id="aiResult-${mode}" hidden></div></div>`;
}

function renderAI() {
  const last = [...state.aiHistory].reverse().slice(0,6);
  return `<div class="page-enter"><div class="hero"><div class="hero-grid"><div><span class="badge">AI PARTNER</span><h2>答えより、人生が進む分析を。</h2><p>事実・推測・改善案・優先順位・今日の一歩を混ぜずに提示します。</p></div><div class="life-score">✦<small>AI</small></div></div></div>
  ${sectionHead('横断分析','人生・健康・仕事・収入・商品をまとめて分析')}${aiComposer('cross','今の人生全体を横断し、最も優先すべきことを一つ選び、その理由と今日の一歩を教えてください。')}
  ${sectionHead('未来シミュレーション','予言ではなく、条件を変えた場合の可能性と行動を整理')}
  <section class="card simulation-panel"><div class="form-grid"><div class="field full"><label>もし何を変えたら？</label><textarea id="simulationCondition" placeholder="例：週3回20分歩く、睡眠を1時間増やす、商品を1つ販売開始する"></textarea></div><div class="field"><label>期間</label><select id="simulationHorizon"><option>1か月</option><option>3か月</option><option selected>半年</option><option>1年</option></select></div><div class="field"><label>守りたい前提</label><input id="simulationAssumptions" placeholder="例：目への負担を増やさない"></div></div><button class="btn" data-action="run-simulation">シミュレーションする</button><div class="ai-result" id="simulationResult" hidden></div></section>
  ${sectionHead('分析理論','必要な理論だけONにできます')}<div class="card theory-grid">${THEORY_OPTIONS.map(theory=>`<label class="toggle-card"><input type="checkbox" data-theory="${theory.id}" ${state.settings.theories[theory.id]?'checked':''}> ${theory.label}</label>`).join('')}</div>
  ${sectionHead('最近のAI分析')}${last.length?`<div class="record-list">${last.map(item=>`<article class="card"><span class="badge blue">${esc(item.persona||item.provider)}</span><h3>${esc(item.question)}</h3><div class="ai-result">${esc(item.answer)}</div><small>${new Date(item.createdAt).toLocaleString('ja-JP')}</small></article>`).join('')}</div>`:'<div class="empty">AI分析履歴はまだありません</div>'}</div>`;
}

function renderProfile() {
  return `<div class="page-enter"><div class="card" style="margin-bottom:16px"><span class="badge">AI BASE DATA</span><h2>あなたを理解する基礎データ</h2><p>空欄は後から少しずつ入力できます。入力済みの項目だけがAI分析に使われます。</p></div><form id="profileForm" class="card form-grid">${PROFILE_FIELDS.map(([id,label,type])=>`<div class="field ${type==='textarea'?'full':''}"><label for="p-${id}">${label}</label>${type==='textarea'?`<textarea id="p-${id}" name="${id}">${esc(state.profile[id])}</textarea>`:`<input id="p-${id}" name="${id}" type="${type}" value="${esc(state.profile[id])}">`}</div>`).join('')}<div class="field full"><div class="btn-row"><button class="btn" type="submit">プロフィールを保存</button><span class="badge">項目単位で安全に同期</span></div></div></form></div>`;
}

function renderData() {
  const synced = Boolean(state.meta.lastSyncedAt);
  const trash = allRows({deleted:true});
  const counts = [['記録',state.records],['目標',state.goals],['習慣',state.habits],['夢・楽しみ',state.wishes],['健康',state.healthItems],['タイムライン',state.timeline],['人生比較',state.comparisons],['商品',state.products],['レビュー',state.reviews],['シミュレーション',state.simulations]];
  return `<div class="page-enter"><div class="grid grid-2"><section class="card"><h2>クラウド同期</h2><div class="status-panel"><span class="status-dot ${synced?'ok':'warn'}"></span><div><b>${synced?'同期済み':'初回同期前'}</b><small style="display:block;color:var(--muted)">${synced?new Date(state.meta.lastSyncedAt).toLocaleString('ja-JP'):'設定で接続情報を登録してください'}</small></div></div><p>Google Sheetsを正本として、プロフィールも点数も項目単位で安全に統合します。</p><div class="btn-row"><button class="btn" data-action="sync">今すぐ同期</button><button class="btn ghost" data-action="test-connection">接続テスト</button></div></section>
  <section class="card"><h2>JSONバックアップ</h2><p>全データを手元に保存します。復元や端末移行に使えます。</p><div class="btn-row"><button class="btn secondary" data-action="export-json">JSONを書き出す</button><button class="btn ghost" data-action="import-json">旧JSONを比較・統合</button></div></section></div>
  ${sectionHead('外部連携','同じ人生データを目的別に再利用')}
  <div class="quick-actions"><button class="quick" data-page="integrations"><b>LINE・相棒専用GPT</b><small>AI連携センターを開く</small></button><button class="quick" data-action="export-notebook"><b>NotebookLM</b><small>人生データを資料化</small></button><button class="quick" data-action="export-story"><b>Story Studio</b><small>人生資産を書き出す</small></button><button class="quick" data-action="export-product"><b>商品設計</b><small>経験を商品へ送る</small></button><button class="quick" data-action="export-kotka"><b>KOTKA AI経営OS</b><small>事業データを書き出す</small></button></div>
  ${sectionHead('データ内訳','現在この端末にある有効データ')}<div class="grid grid-3">${counts.map(([label,rows])=>`<div class="card metric-card"><span class="metric-icon">${activeRows(rows).length}</span><div><small>登録件数</small><b>${label}</b></div></div>`).join('')}</div>
  ${trash.length?`${sectionHead('最近削除したデータ','同期のため削除履歴を保持しています。必要なら復元できます。')}<div class="record-list">${trash.slice(-10).reverse().map(row=>`<article class="record"><span class="record-date">削除済み</span><div><span class="badge red">${esc(KIND_LABELS[row.kind]||row.kind)}</span><h3>${esc(row.title)}</h3></div><div class="record-actions"><button class="btn small secondary" data-action="restore-record" data-kind="${esc(row.kind)}" data-id="${esc(row.id)}">復元</button></div></article>`).join('')}</div>`:''}</div>`;
}

function scopeGrid(channel) {
  const scopes = state.settings.integrations[channel].scopes;
  return `<div class="scope-grid">${DATA_SCOPE_OPTIONS.map(option => {
    const sensitive = ['reviews','health','family','location','finance','aiHistory'].includes(option.id);
    return `<label class="scope-card ${sensitive?'sensitive':''}"><input type="checkbox" data-integration-scope="${channel}" value="${option.id}" ${scopes[option.id]?'checked':''}><span><b>${esc(option.label)}</b><small>${esc(option.description)}</small></span>${sensitive?'<i>慎重</i>':''}</label>`;
  }).join('')}</div>`;
}

function yen(value) { return `約${Math.round(Number(value || 0)).toLocaleString('ja-JP')}円`; }

function renderIntegrations() {
  const integrations = state.settings.integrations;
  const line = integrations.line;
  const gpt = integrations.gpt;
  const cost = estimateGeminiCost(integrations.cost);
  return `<div class="page-enter integrations-page">
    <div class="hero integration-hero"><div class="hero-grid"><div><span class="badge">AI CONNECTION CENTER</span><h2>普段はGemini、深い相談は相棒専用GPTへ。</h2><p>Life Compassを記憶の正本として残し、LINEとChatGPT Plusには許可した情報だけを渡します。未接続の間は既存機能へ影響しません。</p></div><div class="life-score">⌬<small>CONNECT</small></div></div></div>

    ${sectionHead('おすすめの使い分け','月額負担を抑えながら、簡単な相談と高度な分析を分担')}
    <div class="grid grid-3 strategy-grid">
      <article class="card strategy-card"><span class="badge blue">日常</span><h3>公式LINE＋Gemini</h3><p>短い質問、記録、今日の優先順位。1日10回を標準にします。</p></article>
      <article class="card strategy-card"><span class="badge">高度</span><h3>ChatGPT Plusの非公開GPT</h3><p>人生全体、事業、重要判断。Plusの月額内で使う前提です。</p></article>
      <article class="card strategy-card"><span class="badge done">正本</span><h3>Life Compass</h3><p>Google Sheetsの最新データを正本にし、丸ごと外部へ渡しません。</p></article>
    </div>

    ${sectionHead('公式LINE連携','今は土台だけ保存できます。実際の接続時にLINEトークンと安全な受信サーバーを設定します。')}
    <section class="card integration-card">
      <div class="integration-title"><div><span class="status-dot ${line.connected?'ok':'warn'}"></span><div><h3>相棒専用LINE伴走ボット</h3><p>${line.connected?'接続済み':'未接続・Life Compass単体で通常利用できます'}</p></div></div><label class="switch"><input id="lineEnabled" type="checkbox" ${line.enabled?'checked':''}><span></span><b>${line.enabled?'準備ON':'準備OFF'}</b></label></div>
      <div class="form-grid compact-grid"><div class="field"><label>通常回答AI</label><select id="lineProvider"><option value="gemini" selected>Gemini 2.5 Flash</option></select></div><div class="field"><label>1日あたりの上限</label><input id="lineDailyLimit" type="number" min="1" max="100" value="${Number(line.dailyLimit||10)}"></div></div>
      <div class="toggle-row"><label class="toggle-card"><input id="lineSaveHistory" type="checkbox" ${line.saveHistory?'checked':''}> LINE会話をLife Compassへ保存</label><label class="toggle-card"><input id="lineOwnerOnly" type="checkbox" ${line.ownerOnly?'checked':''}> 相棒のLINEユーザーIDだけ許可</label></div>
      <h4>LINEへ渡してよいデータ</h4>${scopeGrid('line')}
    </section>

    ${sectionHead('相棒専用GPT','知識ファイルと指示文を作成し、将来はGPT Actionsで最新データを取得')}
    <section class="card integration-card">
      <div class="integration-title"><div><span class="status-dot ${gpt.connected?'ok':'warn'}"></span><div><h3>ChatGPT Plus｜非公開GPT</h3><p>${gpt.connected?'登録済み':'未登録・まず知識パッケージを書き出せます'}</p></div></div><label class="switch"><input id="gptEnabled" type="checkbox" ${gpt.enabled?'checked':''}><span></span><b>${gpt.enabled?'利用ON':'利用OFF'}</b></label></div>
      <div class="form-grid compact-grid"><div class="field full"><label>作成した相棒専用GPTのURL（後から入力）</label><input id="gptUrl" type="url" value="${esc(gpt.gptUrl||'')}" placeholder="https://chatgpt.com/g/..."></div></div>
      <label class="toggle-card"><input id="gptUseActions" type="checkbox" ${gpt.useActions?'checked':''}> GPT ActionsでLife Compassの最新データを参照する（接続設定後）</label>
      <div class="privacy-notice"><b>非公開が前提です</b><p>振り返り・健康・家族・住所・金銭・AI履歴は初期状態でOFFです。必要な項目だけ自分で許可してください。</p></div>
      <h4>非公開GPTへ渡してよいデータ</h4>${scopeGrid('gpt')}
      <div class="btn-row integration-actions"><button class="btn" data-action="export-gpt-knowledge">① 知識ファイル</button><button class="btn secondary" data-action="export-gpt-instructions">② GPT指示文</button><button class="btn ghost" data-action="export-gpt-actions">③ Actionsひな形</button><button class="btn ghost" data-action="open-private-gpt">ChatGPTで深く相談</button></div>
      <p class="fine-print">Actionsひな形には同期トークンやAPIキーを含めません。実接続時はFirebase Functions等の安全な中継先を設定します。</p>
    </section>

    ${sectionHead('AI利用回数・概算費用','Gemini 2.5 Flash有料APIの参考単価。実際の請求はトークン数・為替で変わります。')}
    <section class="card cost-card"><div class="form-grid cost-inputs"><div class="field"><label>1日の質問回数</label><input id="costQuestions" type="number" min="0" max="1000" value="${integrations.cost.questionsPerDay}"></div><div class="field"><label>1回の入力トークン</label><input id="costInputTokens" type="number" min="0" step="100" value="${integrations.cost.inputTokens}"></div><div class="field"><label>1回の回答トークン</label><input id="costOutputTokens" type="number" min="0" step="100" value="${integrations.cost.outputTokens}"></div><div class="field"><label>1ドル（円）</label><input id="costUsdJpy" type="number" min="1" value="${integrations.cost.usdJpy}"></div></div>
      <div class="grid grid-4 cost-results" id="costResults"><div class="metric-card card"><div><small>Gemini／1日</small><b>${yen(cost.dailyYen)}</b></div></div><div class="metric-card card"><div><small>Gemini／1か月</small><b>${yen(cost.monthlyYen)}</b></div></div><div class="metric-card card"><div><small>Gemini／1年</small><b>${yen(cost.yearlyYen)}</b></div></div><div class="metric-card card"><div><small>月間質問数</small><b>${cost.monthlyQuestions.toLocaleString('ja-JP')}回</b></div></div></div>
      <p class="cost-summary">ChatGPTの高度な相談はPlus内の非公開GPTで行うため、OpenAI APIの従量料金はこの試算に含めません。</p>
    </section>
    <div class="sticky-save"><button class="btn" data-action="save-integrations">AI連携設定を保存</button></div>
  </div>`;
}

function renderSettings() {
  return `<div class="page-enter"><div class="grid grid-2"><section class="card"><h2>同期・AI接続</h2><div class="field"><label>GASウェブアプリURL</label><input id="gasUrl" type="url" value="${esc(state.settings.gasUrl)}" placeholder="https://script.google.com/macros/s/.../exec"></div><div class="field" style="margin-top:12px"><label>同期トークン</label><input id="syncToken" type="password" value="${esc(state.settings.syncToken)}" autocomplete="off" placeholder="GASで発行した長い英数字"></div><label class="toggle-card" style="margin-top:12px"><input id="autoSync" type="checkbox" ${state.settings.autoSync?'checked':''}> 変更後に自動同期する</label><p style="color:var(--muted);font-size:12px">APIキーは画面に保存せず、GASのスクリプトプロパティだけに保管します。</p><div class="btn-row"><button class="btn" data-action="save-settings">接続設定を保存</button><button class="btn ghost" data-action="test-connection">接続テスト</button></div></section><section class="card"><h2>表示とアプリ</h2><div class="field"><label>文字サイズ</label><select id="fontScale"><option value="0.95" ${state.settings.fontScale==.95?'selected':''}>少し小さめ</option><option value="1" ${state.settings.fontScale==1?'selected':''}>標準</option><option value="1.1" ${state.settings.fontScale==1.1?'selected':''}>大きめ</option><option value="1.2" ${state.settings.fontScale==1.2?'selected':''}>より大きく</option></select></div><div class="btn-row" style="margin-top:14px"><button class="btn secondary" data-action="save-display">表示を保存</button><button class="btn ghost" data-action="install-app">ホーム画面に追加</button></div></section></div>
  ${sectionHead('安全とデータ')}<section class="card"><h3>データの役割</h3><p><b>Google Sheets：</b>正本　 <b>Google Drive：</b>画像・添付　 <b>この端末：</b>設定とキャッシュ　 <b>JSON：</b>バックアップ・移行</p><button class="btn secondary" data-action="export-json">全データをバックアップ</button></section>
  ${sectionHead('端末の初期化')}<section class="card danger-zone"><h3>この端末だけを初期化</h3><p>クラウド正本や他端末のデータは削除しません。必ず先にJSONバックアップを保存してください。</p><button class="btn danger" data-action="reset-local">端末キャッシュを初期化</button></section></div>`;
}

function renderSearch() {
  return `<div class="page-enter"><div class="search-box"><input id="globalSearch" type="search" placeholder="記録・健康・目標・夢・行きたい場所・挑戦・体験などを検索" autocomplete="off"></div><div class="filter-row"><button class="filter-chip active" data-search-kind="all">すべて</button>${Object.entries(KIND_LABELS).map(([kind,label])=>`<button class="filter-chip" data-search-kind="${kind}">${label}</button>`).join('')}</div>${sectionHead('検索結果','入力すると全データから探します。')}<div id="searchResults" class="record-list"><div class="empty">検索語を入力してください</div></div></div>`;
}

function recordList(rows, kind, wrap = true) {
  const active = activeRows(rows);
  const html = active.length ? active.map(row => recordCard(row,kind)).join('') : '<div class="empty">まだ記録がありません</div>';
  return wrap ? `<div class="record-list">${html}</div>` : html;
}

function recordCard(row, fallbackKind) {
  const kind = row.kind || fallbackKind;
  const progress = kind === 'goal' && row.details?.progress !== undefined ? Number(row.details.progress) : null;
  const attachments = Array.isArray(row.details?.attachments) ? row.details.attachments : [];
  return `<article class="record"><span class="record-date">${displayDate(row.date)}</span><div><span class="badge">${esc(domainLabel(row.domain))}</span><h3>${esc(row.title)}</h3><p>${esc(row.body)}</p>${progress!==null?`<div class="progress" title="進捗 ${progress}%"><i style="width:${Math.max(0,Math.min(100,progress))}%"></i></div>`:''}<div class="record-meta">${row.details?.wishType?`<span class="badge blue">${esc(row.details.wishType)}</span>`:''}${row.details?.experienceType?`<span class="badge">${esc(row.details.experienceType)}</span>`:''}${row.details?.wishStatus?`<span class="badge ${row.details.wishStatus==='実現済み'?'done':''}">${esc(row.details.wishStatus)}</span>`:''}${row.details?.priority?`<span class="badge ${row.details.priority==='高'?'warn':''}">優先度 ${esc(row.details.priority)}</span>`:''}${row.details?.frequency?`<span class="badge">${esc(row.details.frequency)}</span>`:''}${row.details?.budget?`<span class="badge">予算 ${esc(row.details.budget)}</span>`:''}</div>${attachments.map(file=>`<a class="attachment-link" href="${esc(file.url)}" target="_blank" rel="noopener">添付：${esc(file.name)}</a>`).join('')}</div><div class="record-actions"><button class="btn small ghost" data-action="view-record" data-kind="${esc(kind)}" data-id="${esc(row.id)}">見る</button><button class="btn small ghost" data-action="edit-record" data-kind="${esc(kind)}" data-id="${esc(row.id)}">編集</button><button class="btn small danger" data-action="delete-record" data-kind="${esc(kind)}" data-id="${esc(row.id)}">削除</button></div></article>`;
}

function render() {
  updateChrome();
  const views = {home:renderHome,life:renderLife,health:renderHealth,work:renderWork,timeline:renderTimeline,reviews:renderReviews,ai:renderAI,integrations:renderIntegrations,data:renderData,profile:renderProfile,settings:renderSettings,search:renderSearch};
  $('#app').innerHTML = (views[page] || renderHome)();
  bindPage();
}

function bindPage() {
  document.querySelectorAll('[data-score]').forEach(element => element.addEventListener('input',()=>element.nextElementSibling.value=element.value));
  document.querySelectorAll('[data-setting]').forEach(element => element.addEventListener('change',()=>{state.settings[element.dataset.setting]=element.value;commit(state,'AI設定を変更しました')}));
  document.querySelectorAll('[data-theory]').forEach(element => element.addEventListener('change',()=>{state.settings.theories[element.dataset.theory]=element.checked;commit(state,'分析理論を更新しました')}));
  $('#profileForm')?.addEventListener('submit',event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const now = isoNow();
    const fieldUpdatedAt = {...state.profile.fieldUpdatedAt};
    for (const [key,value] of Object.entries(data)) if (String(value) !== String(state.profile[key] ?? '')) fieldUpdatedAt[key] = now;
    state.profile = {...state.profile,...data,fieldUpdatedAt,updatedAt:now};
    commit(state,'プロフィールを保存しました');
  });
  $('#globalSearch')?.addEventListener('input', updateSearchResults);
  document.querySelectorAll('[data-search-kind]').forEach(button => button.addEventListener('click',()=>{
    searchKind=button.dataset.searchKind;
    document.querySelectorAll('[data-search-kind]').forEach(item=>item.classList.toggle('active',item===button));
    updateSearchResults();
  }));
  document.querySelectorAll('#costQuestions,#costInputTokens,#costOutputTokens,#costUsdJpy').forEach(input => input.addEventListener('input', updateCostPreview));
}

function detailFieldHtml(kind, details = {}) {
  return (DETAIL_FIELDS[kind] || []).map(([key,label,type,options]) => {
    const value = details[key] ?? '';
    if (type === 'textarea') return `<div class="field full"><label>${label}</label><textarea name="detail__${key}">${esc(value)}</textarea></div>`;
    if (type === 'select') return `<div class="field"><label>${label}</label><select name="detail__${key}">${String(options).split('|').map(option=>`<option value="${esc(option)}" ${String(value)===option?'selected':''}>${option===''?'選択してください':option==='weekly'?'週間':option==='monthly'?'月間':option==='yearly'?'年間':esc(option)}</option>`).join('')}</select></div>`;
    return `<div class="field"><label>${label}</label><input name="detail__${key}" type="${type}" value="${esc(value)}" ${type==='number'?'min="0" max="100"':''}></div>`;
  }).join('');
}

function openRecordDialog(kind, id = '') {
  const key = collectionFor(kind);
  if (!key) return toast('未対応の記録種類です','error');
  const existing = id ? state[key].find(row => row.id === id) : null;
  const dialog = $('#recordDialog');
  const titlePlaceholder = kind === 'wish' ? '例：キャンピングカー、北海道旅行、Kindle出版' : '例：朝の血圧、今月の目標、事業アイデア';
  const bodyPlaceholder = kind === 'wish' ? '欲しいもの・場所・挑戦・体験と、叶えたいイメージを自由に書いてください' : '事実や気づきを自由に書いてください';
  dialog.innerHTML = `<form id="recordForm"><div class="modal-head"><div><span class="badge">${existing?'編集':'新規'}</span><h2>${esc(KIND_LABELS[kind])}</h2></div><button class="icon-btn" type="button" data-close>×</button></div><div class="modal-body form-grid"><input type="hidden" name="kind" value="${kind}"><div class="field"><label>日付</label><input name="date" type="date" value="${esc(existing?.date || localDateKey())}" required></div><div class="field"><label>関連する分野</label><select name="domain">${DOMAINS.map(domain=>`<option value="${domain.id}" ${(existing?.domain || defaultDomain(kind))===domain.id?'selected':''}>${domain.label}</option>`).join('')}</select></div><div class="field full"><label>タイトル</label><input name="title" value="${esc(existing?.title || '')}" required placeholder="${titlePlaceholder}"></div><div class="field full"><label>概要・自由メモ</label><textarea name="body" placeholder="${bodyPlaceholder}">${esc(existing?.body || '')}</textarea></div>${detailFieldHtml(kind,existing?.details)}<div class="field full"><label>タグ</label><input name="tags" value="${esc((existing?.tags||[]).join('、'))}" placeholder="健康、挑戦、家族 など"></div><div class="field full"><label>画像・添付（任意・8MB以下）</label><input name="attachment" type="file"><span class="hint">添付はGoogle Driveへ保存します。同期設定が必要です。</span></div><p class="mobile-sheet-note field full">下へスクロールすると保存ボタンがあります。</p></div><div class="modal-actions"><button class="btn ghost" type="button" data-close>キャンセル</button><button class="btn" type="submit">${existing?'更新する':'保存する'}</button></div></form>`;
  dialog.showModal();
  dialog.querySelectorAll('[data-close]').forEach(button => button.onclick=()=>dialog.close());
  if (kind === 'wish') {
    const typeSelect = dialog.querySelector('[name="detail__wishType"]');
    const subtypeSelect = dialog.querySelector('[name="detail__experienceType"]');
    const updateSubtypeVisibility = () => {
      const applies = typeSelect.value === 'やってみたいこと・挑戦・体験';
      subtypeSelect.closest('.field').hidden = !applies;
      if (!applies) subtypeSelect.value = '';
    };
    typeSelect.addEventListener('change', updateSubtypeVisibility);
    updateSubtypeVisibility();
  }
  $('#recordForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.submitter;
    if (submit) { submit.disabled=true; submit.textContent='保存中…'; }
    const form = event.currentTarget;
    const raw = Object.fromEntries(new FormData(form));
    const details = {...(existing?.details || {})};
    for (const [name,value] of Object.entries(raw)) if (name.startsWith('detail__')) details[name.slice(8)] = value;
    if (kind === 'wish' && details.wishType !== 'やってみたいこと・挑戦・体験') delete details.experienceType;
    const base = {...(existing || {}),date:raw.date,domain:raw.domain,title:raw.title,body:raw.body,tags:raw.tags,details,updatedAt:isoNow()};
    const record = normalizeRecord(base,kind);
    if (existing) state[key][state[key].findIndex(row=>row.id===id)] = record;
    else state[key].push(record);
    const file = form.elements.attachment?.files?.[0];
    if (file) {
      try {
        const attachment = await uploadAttachment(state,file);
        record.details.attachments = [...(record.details.attachments || []),attachment];
      } catch (error) {
        toast(`本文は保存しましたが、添付は保存できませんでした：${error.message}`,'error');
      }
    }
    commit(state,`${KIND_LABELS[kind]}を${existing?'更新':'保存'}しました`);
    dialog.close();
    render();
  });
}

function defaultDomain(kind) {
  if (kind === 'healthItem') return 'health';
  if (kind === 'product') return 'work';
  if (kind === 'goal') return 'challenge';
  if (kind === 'wish') return 'freedom';
  return 'happiness';
}

function showRecord(kind,id) {
  const row = state[collectionFor(kind)]?.find(item=>item.id===id);
  if (!row) return;
  const detailRows = Object.entries(row.details || {}).filter(([key,value]) => value && key !== 'attachments').map(([key,value])=>`<div class="detail-row"><small>${esc(DETAIL_LABELS[key]||key)}</small><p>${esc(value)}</p></div>`).join('');
  const attachments = (row.details?.attachments || []).map(file=>`<a class="attachment-link" href="${esc(file.url)}" target="_blank" rel="noopener">${esc(file.name)}</a>`).join('');
  const dialog = $('#detailDialog');
  dialog.innerHTML = `<div class="modal-head"><div><span class="badge">${esc(KIND_LABELS[kind]||kind)}</span><h2>${esc(row.title)}</h2></div><button class="icon-btn" data-close>×</button></div><div class="modal-body"><div class="detail-grid"><div class="detail-row"><small>日付・分野</small><p>${displayDate(row.date)} ／ ${esc(domainLabel(row.domain))}</p></div>${row.body?`<div class="detail-row"><small>概要・メモ</small><p>${esc(row.body)}</p></div>`:''}${detailRows}${attachments?`<div class="detail-row"><small>添付</small>${attachments}</div>`:''}</div></div><div class="modal-actions"><button class="btn ghost" data-close>閉じる</button><button class="btn" data-action="edit-from-detail" data-kind="${esc(kind)}" data-id="${esc(id)}">編集する</button></div>`;
  dialog.showModal();
  dialog.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>dialog.close());
  dialog.querySelector('[data-action="edit-from-detail"]').onclick=()=>{dialog.close();openRecordDialog(kind,id)};
}

function currentScopes(channel) {
  const inputs = [...document.querySelectorAll(`[data-integration-scope="${channel}"]`)];
  if (!inputs.length) return { ...state.settings.integrations[channel].scopes };
  return Object.fromEntries(DATA_SCOPE_OPTIONS.map(option => [
    option.id, Boolean(inputs.find(input => input.value === option.id)?.checked)
  ]));
}

function currentCostConfig() {
  const saved = state.settings.integrations.cost;
  return {
    ...saved,
    questionsPerDay: Number($('#costQuestions')?.value ?? saved.questionsPerDay),
    inputTokens: Number($('#costInputTokens')?.value ?? saved.inputTokens),
    outputTokens: Number($('#costOutputTokens')?.value ?? saved.outputTokens),
    usdJpy: Number($('#costUsdJpy')?.value ?? saved.usdJpy)
  };
}

function updateCostPreview() {
  const target = $('#costResults');
  if (!target) return;
  const cost = estimateGeminiCost(currentCostConfig());
  target.innerHTML = `<div class="metric-card card"><div><small>Gemini／1日</small><b>${yen(cost.dailyYen)}</b></div></div><div class="metric-card card"><div><small>Gemini／1か月</small><b>${yen(cost.monthlyYen)}</b></div></div><div class="metric-card card"><div><small>Gemini／1年</small><b>${yen(cost.yearlyYen)}</b></div></div><div class="metric-card card"><div><small>月間質問数</small><b>${cost.monthlyQuestions.toLocaleString('ja-JP')}回</b></div></div>`;
}

function saveIntegrationSettings({ message = 'AI連携設定を保存しました', rerender = true } = {}) {
  const integrations = state.settings.integrations;
  integrations.line = {
    ...integrations.line,
    enabled: Boolean($('#lineEnabled')?.checked),
    provider: 'gemini',
    dailyLimit: Math.max(1, Math.min(100, Number($('#lineDailyLimit')?.value || 10))),
    saveHistory: Boolean($('#lineSaveHistory')?.checked),
    ownerOnly: Boolean($('#lineOwnerOnly')?.checked),
    scopes: currentScopes('line')
  };
  const gptUrl = $('#gptUrl')?.value.trim() || '';
  integrations.gpt = {
    ...integrations.gpt,
    enabled: Boolean($('#gptEnabled')?.checked),
    connected: /^https:\/\/chatgpt\.com\//i.test(gptUrl),
    useActions: Boolean($('#gptUseActions')?.checked),
    gptUrl,
    scopes: currentScopes('gpt')
  };
  integrations.cost = currentCostConfig();
  commit(state, message, { autoSync: true, rerender });
}

function exportGptArtifact(type) {
  const scopes = currentScopes('gpt');
  if (type === 'knowledge') {
    const text = buildCloneKnowledgeMarkdown(state, scopes);
    downloadBlob(new Blob([text], { type:'text/markdown;charset=utf-8' }), `LifeCompass_PrivateGPT_Knowledge_${dateStamp()}.md`);
    toast('相棒専用GPTの知識ファイルを書き出しました');
  } else if (type === 'instructions') {
    downloadBlob(new Blob([buildCloneInstructions()], { type:'text/plain;charset=utf-8' }), `LifeCompass_PrivateGPT_Instructions_${dateStamp()}.txt`);
    toast('GPTへ貼り付ける指示文を書き出しました');
  } else {
    const text = JSON.stringify(buildActionsOpenApiTemplate(), null, 2);
    downloadBlob(new Blob([text], { type:'application/json;charset=utf-8' }), `LifeCompass_GPT_Actions_Template_${dateStamp()}.json`);
    toast('秘密情報を含まないActionsひな形を書き出しました');
  }
}

async function handleAction(action, element) {
  try {
    if (action === 'new-record') return openRecordDialog(element.dataset.kind);
    if (action === 'edit-record') return openRecordDialog(element.dataset.kind,element.dataset.id);
    if (action === 'view-record') return showRecord(element.dataset.kind,element.dataset.id);
    if (action === 'save-scores') {
      const now=isoNow();
      document.querySelectorAll('[data-score]').forEach(input=>{if(Number(state.scores[input.dataset.score])!==Number(input.value)){state.scores[input.dataset.score]=Number(input.value);state.scoreUpdatedAt[input.dataset.score]=now}});
      commit(state,'人生レーダーを保存しました',{rerender:true}); return;
    }
    if (action === 'done') {
      const row = state[collectionFor(element.dataset.kind)]?.find(item=>item.id===element.dataset.id);
      if (row) { row.status='done'; row.updatedAt=isoNow(); commit(state,'完了にしました',{rerender:true}); } return;
    }
    if (action === 'delete-record') {
      const row = state[collectionFor(element.dataset.kind)]?.find(item=>item.id===element.dataset.id);
      if (row && confirm('この記録を削除しますか？ 後から「連携・移行」で復元できます。')) { row.deletedAt=isoNow();row.updatedAt=isoNow();commit(state,'記録を削除しました',{rerender:true}); } return;
    }
    if (action === 'restore-record') {
      const row = state[collectionFor(element.dataset.kind)]?.find(item=>item.id===element.dataset.id);
      if (row) { row.deletedAt=null;row.updatedAt=isoNow();commit(state,'記録を復元しました',{rerender:true}); } return;
    }
    if (action === 'ask-ai') return runAI(element.dataset.mode);
    if (action === 'quick-ai') return setPage('ai');
    if (action === 'run-simulation') return runSimulation();
    if (action === 'generate-review') return generateReview(element.dataset.period,element);
    if (action === 'sync') return performSync();
    if (action === 'test-connection') {
      const url = $('#gasUrl')?.value.trim() || state.settings.gasUrl;
      const token = $('#syncToken')?.value.trim() || state.settings.syncToken;
      element.disabled=true;element.textContent='確認中…';
      const result=await testConnection(url,token);toast(`接続できました（クラウド版 ${result.revision}）`);element.disabled=false;element.textContent='接続テスト';return;
    }
    if (action === 'save-integrations') return saveIntegrationSettings();
    if (action === 'export-gpt-knowledge') return exportGptArtifact('knowledge');
    if (action === 'export-gpt-instructions') return exportGptArtifact('instructions');
    if (action === 'export-gpt-actions') return exportGptArtifact('actions');
    if (action === 'open-private-gpt') {
      const url = ($('#gptUrl')?.value.trim() || state.settings.integrations.gpt.gptUrl || 'https://chatgpt.com/gpts');
      if (!/^https:\/\/chatgpt\.com\//i.test(url)) throw new Error('ChatGPTの正しいGPT URLを入力してください');
      window.open(url, '_blank', 'noopener,noreferrer'); return;
    }
    if (action === 'export-json') { downloadBlob(exportBackup(state),`LifeCompassAIOS_backup_${dateStamp()}.json`);toast('JSONバックアップを書き出しました');return; }
    if (action === 'import-json') return $('#jsonFile').click();
    if (action.startsWith('export-')) return exportFor(action);
    if (action === 'save-settings') { state.settings.gasUrl=$('#gasUrl').value.trim();state.settings.syncToken=$('#syncToken').value.trim();state.settings.syncEnabled=Boolean(state.settings.gasUrl&&state.settings.syncToken);state.settings.autoSync=$('#autoSync').checked;commit(state,'接続設定を保存しました',{autoSync:false,rerender:true});return; }
    if (action === 'save-display') { state.settings.fontScale=Number($('#fontScale').value);commit(state,'表示設定を保存しました',{rerender:true});return; }
    if (action === 'install-app') return installApp();
    if (action === 'reset-local' && confirm('この端末のキャッシュを初期化します。クラウド正本は削除されません。先にJSONバックアップを保存しましたか？')) { localStorage.removeItem(CACHE_KEY);localStorage.removeItem(SETTINGS_KEY);state=createEmptyState();state=saveCache(state,{touch:false});toast('この端末のキャッシュを初期化しました');render(); }
  } catch (error) { toast(error.message || String(error),'error'); render(); }
}

async function runAI(mode) {
  const question = $(`#aiQuestion-${mode}`);
  const result = $(`#aiResult-${mode}`);
  if (!question?.value.trim()) return toast('相談内容を入力してください','error');
  result.hidden=false;result.classList.add('loading');result.textContent='人生データを整理して分析しています…';
  try {
    const item=await askAI(state,question.value.trim(),mode);
    state.aiHistory.push(item);state.aiHistory=state.aiHistory.slice(-100);
    commit(state,'AI分析を保存しました');
    result.classList.remove('loading');result.textContent=item.answer;
  } catch (error) { result.classList.remove('loading');result.textContent=`エラー：${error.message}`;toast(error.message,'error'); }
}

async function runSimulation() {
  const condition=$('#simulationCondition').value.trim(),horizon=$('#simulationHorizon').value,assumptions=$('#simulationAssumptions').value.trim(),result=$('#simulationResult');
  if(!condition)return toast('変える条件を入力してください','error');
  const question=`【未来シミュレーション】\n変える条件：${condition}\n期間：${horizon}\n守る前提：${assumptions||'特になし'}\n予言ではなく、期待できる変化、変わらない可能性、リスク、途中で確認する指標、今日の一歩を条件付きで示してください。`;
  result.hidden=false;result.classList.add('loading');result.textContent='条件別の変化をシミュレーションしています…';
  try {
    const item=await askAI(state,question,'simulation');
    state.aiHistory.push(item);
    state.simulations.push(normalizeRecord({kind:'simulation',domain:'challenge',title:`${horizon}｜${condition.slice(0,40)}`,body:item.answer,details:{condition,horizon,assumptions},date:localDateKey(),createdAt:item.createdAt,updatedAt:item.createdAt},'simulation'));
    commit(state,'シミュレーション結果を保存しました');result.classList.remove('loading');result.textContent=item.answer;
  }catch(error){result.classList.remove('loading');result.textContent=`エラー：${error.message}`;toast(error.message,'error')}
}

async function generateReview(period,button) {
  const labels={weekly:'週間',monthly:'月間',yearly:'年間'};
  button.disabled=true;button.textContent='レビュー作成中…';
  try {
    const question=`${labels[period]}レビューを作成してください。登録データから、①事実 ②できたこと ③うまくいかなかったこと ④変化 ⑤最優先事項（3つ以内）⑥今日からの一歩、の順に整理してください。データにないことは推測と明記してください。`;
    const item=await askAI(state,question,`review_${period}`);
    state.aiHistory.push(item);
    state.reviews.push(normalizeRecord({kind:'review',domain:'happiness',title:`${labels[period]}レビュー`,body:item.answer,date:localDateKey(),details:{period},createdAt:item.createdAt,updatedAt:item.createdAt},'review'));
    commit(state,`${labels[period]}レビューを保存しました`);render();
  } catch(error) { button.disabled=false;button.textContent='もう一度試す';toast(error.message,'error'); }
}

function exportFor(action) {
  let text=buildNotebookMarkdown(state), name='LifeCompass_NotebookLM_Source', mime='text/markdown',ext='md';
  if(action==='export-story'){name='LifeCompass_StoryStudio_Source';text+='\n\n## Story Studio向け\n上記の転機・苦労・実績・価値観から、読者の役に立つ物語素材を抽出してください。'}
  if(action==='export-product'){name='LifeCompass_ProductDesign_Source';text+='\n\n## 商品設計向け\n経験・実績・悩み・強みを、顧客課題と商品案へ変換してください。'}
  if(action==='export-kotka'){name='LifeCompass_KOTKA_Source';mime='application/json';ext='json';text=JSON.stringify({format:'LifeCompassToKOTKA',exportedAt:isoNow(),scores:{work:state.scores.work,income:state.scores.income,freedom:state.scores.freedom},products:activeRows(state.products),goals:activeRows(state.goals).filter(row=>['work','income'].includes(row.domain)),reviews:activeRows(state.reviews).slice(-6)},null,2)}
  downloadBlob(new Blob([text],{type:mime}),`${name}_${dateStamp()}.${ext}`);toast('連携用データを書き出しました');
}

function downloadBlob(blob,name) { const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000); }
function dateStamp() { return localDateKey().replaceAll('-',''); }

async function inspectFiles(files) {
  try {
    const selected=[...files];
    const parsed=await Promise.all(selected.map(async file=>JSON.parse(await file.text())));
    migrationInspection=parsed.length>1?inspectLegacyJsonBatch(parsed,state):inspectLegacyJson(parsed[0],state);
    showMigration(selected.map(file=>file.name));
  } catch(error) { toast(`JSONを読み込めません：${error.message}`,'error'); }
}

function showMigration(fileNames = []) {
  const {stats,issues}=migrationInspection,dialog=$('#migrationDialog');
  const sourceText=stats.sourceCount>1?`${stats.sourceCount}ファイルを比較しました。`:'1ファイルを検査しました。';
  dialog.innerHTML=`<div class="modal-head"><div><span class="badge">安全な移行</span><h2>旧JSONの比較結果</h2></div><button class="icon-btn" data-close>×</button></div><div class="modal-body"><p>${sourceText} まだ新OSへ反映していません。</p>${fileNames.length?`<p class="migration-detail">${fileNames.map(esc).join(' ／ ')}</p>`:''}<div class="migration-summary"><div class="card"><b>${stats.imported}</b><small>追加候補</small></div><div class="card"><b>${stats.duplicates}</b><small>重複</small></div><div class="card"><b>${stats.conflicts}</b><small>競合</small></div><div class="card"><b>${stats.repaired||0}</b><small>復元対象</small></div></div>${issues.map(issue=>`<p class="migration-notice">${esc(issue)}</p>`).join('')}<p class="migration-detail">プロフィール ${stats.profileFields||0}項目／プロフィールから専用領域へ移す記録 ${stats.profileDerivedRecords||0}件</p><h3>統合方法</h3><div class="form-grid"><div class="field"><label>プロフィール</label><select id="migrationProfile"><option value="fill_empty">新OSの空欄を旧データで補う（推奨）</option><option value="current">現在の新OSを維持</option><option value="incoming">最も入力が多い旧プロフィールを採用</option></select></div><div class="field"><label>同じIDで内容が異なる場合</label><select id="migrationConflict"><option value="current">現在の新OSを維持（推奨）</option><option value="keep_both">両方残す</option><option value="incoming">旧JSONを採用</option></select></div></div><p><b>重複は追加しません。</b>一発上書きではなくID単位で統合します。</p></div><div class="modal-actions"><button class="btn ghost" data-close>中止</button><button class="btn" data-action="apply-migration">この内容で統合</button></div>`;
  dialog.showModal();dialog.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>dialog.close());
  dialog.querySelector('[data-action="apply-migration"]').onclick=()=>{state=migrationInspection.batch?applyMigrationBatch(state,migrationInspection,{profile:$('#migrationProfile').value,conflict:$('#migrationConflict').value}):applyMigration(state,migrationInspection,{profile:$('#migrationProfile').value,conflict:$('#migrationConflict').value});commit(state,'旧JSONを新OSへ統合しました');dialog.close();render()};
}

function updateSearchResults() {
  const query=$('#globalSearch')?.value.trim().toLowerCase() || '';
  const rows=allRows().filter(row=>searchKind==='all'||row.kind===searchKind).filter(row=>!query||[row.title,row.body,row.tags?.join(' '),JSON.stringify(row.details||{})].join(' ').toLowerCase().includes(query));
  $('#searchResults').innerHTML=query?rows.slice(0,100).map(row=>recordCard(row,row.kind)).join('')||'<div class="empty">一致するデータがありません</div>':'<div class="empty">検索語を入力してください</div>';
}

async function installApp() {
  if (deferredInstallPrompt) { deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;$('#installButton').hidden=true;return; }
  toast('ブラウザのメニューから「ホーム画面に追加」または「アプリをインストール」を選んでください');
}

document.addEventListener('click',event=>{
  const pageElement=event.target.closest('[data-page]');if(pageElement)return setPage(pageElement.dataset.page);
  const actionElement=event.target.closest('[data-action]');if(actionElement)handleAction(actionElement.dataset.action,actionElement);
});
$('#menuButton').onclick=()=>$('#sidebar').classList.toggle('open');
$('#jsonFile').addEventListener('change',event=>{if(event.target.files.length)inspectFiles(event.target.files);event.target.value=''});
window.addEventListener('hashchange',()=>{page=location.hash.slice(1)||'home';render()});
window.addEventListener('online',()=>{updateChrome();scheduleAutoSync()});
window.addEventListener('offline',()=>updateChrome());
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;$('#installButton').hidden=false});
$('#todayLabel').textContent=new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short',timeZone:'Asia/Tokyo'}).format(new Date());
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
render();
scheduleAutoSync();
