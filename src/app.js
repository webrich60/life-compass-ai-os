import {
  DOMAINS, THEORY_OPTIONS, PERSONAS, WISH_TYPES, WISH_AREAS, EXPERIENCE_TYPES, createEmptyState, normalizeRecord,
  calculateLifeScore, todayTasks, isoNow, localDateKey, activeRows, reviewDue,
  normalizeExternalUrl, normalizeReferenceLinks, MAX_REFERENCE_LINKS
} from './model.js';
import {
  loadCache, saveCache, exportBackup, synchronize,
  testConnection, uploadAttachment, clearLocalCache, refreshNotebookLMSheets
} from './storage.js';
import { inspectLegacyJson, applyMigration, inspectLegacyJsonBatch, applyMigrationBatch } from './migration.js';
import { askAI, buildNotebookMarkdown } from './ai.js';
import {
  DATA_SCOPE_OPTIONS, buildCloneKnowledgeMarkdown, buildCloneInstructions,
  buildActionsOpenApiTemplate, estimateGeminiCost
} from './integrations.js';
import { findDuplicateCandidates, findDuplicatePairs } from './duplicates.js';

const PAGES = [
  ['home','⌂','ホーム'], ['life','◎','人生設計'], ['health','♡','健康'],
  ['work','▣','事業'], ['income','¥','お金'], ['timeline','⌁','タイムライン'], ['reviews','◷','定期レビュー'],
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
  wish:'夢・楽しみ', comparison:'人生比較', product:'商品・事業の種', incomeRecord:'収入記録',
  expenseRecord:'支出記録', fixedCostRecord:'固定費', debtRecord:'負債・借入',
  review:'定期レビュー', simulation:'未来シミュレーション'
};
const DETAIL_FIELDS = {
  record:[['mood','気分（任意）','text'],['energy','エネルギー 0〜100','number']],
  goal:[['dueDate','期限','date'],['priority','優先度','select','高|中|低'],['progress','進捗 0〜100','number'],['goalStatus','達成状況','select','進行中|一時停止|達成済み']],
  habit:[['habitCategory','習慣の種類','select','|食事|運動|睡眠|健康管理|学習|仕事|生活|その他'],['frequency','頻度','select','毎日|週1回|週2回|週3回|平日|自由設定'],['target','続ける基準','text']],
  wish:[
    ['wishType','種類','select',WISH_TYPES.join('|')],
    ['wishArea','分野','select',WISH_AREAS.join('|')],
    ['experienceType','挑戦・体験の種類（該当するとき）','select',`|${EXPERIENCE_TYPES.join('|')}`],
    ['targetDate','実現したい時期','date'],
    ['priority','優先度','select','高|中|低'],['budget','予算の目安','text'],
    ['wishStatus','実現状況','select','いつか|検討中|計画中|実現済み'],['reason','実現したい理由','textarea'],
    ['firstStep','最初の一歩','textarea'],['companion','一緒に実現したい人（任意）','text']
  ],
  healthItem:[
    ['healthItemType','健康・医療の種類','select','症状・健康管理|治療・手術計画|検査・受診予定|メンタル|その他'],
    ['medicalStatus','医療計画の状態','select','|情報収集中|相談予定|予約済み|方針決定|実施予定|経過観察|完了'],
    ['facilityWishId','関連する病院・クリニック','medicalPlace',''],
    ['department','診療科・担当科','text'],['targetDate','予定・目標日','date'],['estimatedCost','費用の目安','text'],
    ['hospitalDays','入院・通院期間の目安','text'],['recoveryTime','回復・療養期間の目安','text'],
    ['physicalImpact','身体への負担','select','|低|中|高'],['mentalImpact','メンタルへの負担','select','|低|中|高'],['incomeImpact','収入・仕事への影響','select','|低|中|高'],
    ['history','この項目の経過・これまで（個別情報）','textarea'],['current','現在の状態','textarea'],['ideal','理想状態','textarea'],
    ['improvements','考えられる改善方法','textarea'],['firstStep','まずやること','textarea'],
    ['ifNoChange','改善しない場合','textarea'],['doctorQuestions','専門医へ相談すること','textarea']
  ],
  comparison:[['pastIdeal','過去の理想','textarea'],['current','現在','textarea'],['newIdeal','新しい理想','textarea'],['gaps','差分・障害','textarea']],
  timeline:[['valueChange','その時に変わった価値観','textarea']],
  product:[['customer','誰のための商品か','text'],['problem','解決する悩み','textarea'],['offer','提供内容','textarea'],['price','想定価格','text'],['nextValidation','次の検証','textarea']],
  incomeRecord:[
    ['incomeType','収入の種類','select','給与|年金|事業収入|副収入|配当・利息|給付・手当|臨時収入|その他'],
    ['amount','金額（円）','number'],['amountKind','金額区分','select','手取り|税引前|概算'],
    ['sourceName','収入元','text'],['incomePeriod','対象年月','month'],
    ['incomeFrequency','頻度','select','単発|毎月|毎年|不定期'],
    ['incomeStatus','状態','select','確定|見込|未入金']
  ],
  expenseRecord:[
    ['expenseType','支出の種類','select','生活費|医療|住居|交通|娯楽|家族|税・社会保険|事業|臨時支出|その他'],
    ['amount','金額（円）','number'],['expensePeriod','対象年月','month'],
    ['payee','支払先・用途','text'],['expenseStatus','状態','select','確定|予定']
  ],
  fixedCostRecord:[
    ['fixedCostType','固定費の種類','select','住居|光熱|通信|保険|医療|車|サブスク|事業固定費|その他'],
    ['amount','金額（円）','number'],['fixedCostFrequency','支払頻度','select','毎月|2か月ごと|半年|毎年'],
    ['payee','支払先','text'],['fixedCostStart','開始年月','month'],['fixedCostEnd','終了予定（任意）','month'],
    ['fixedCostStatus','状態','select','継続中|見直し候補|終了']
  ],
  debtRecord:[
    ['debtType','負債・借入の種類','select','借入金|住宅・自動車ローン|カード分割・リボ|家族・知人|事業借入|その他'],
    ['lenderName','借入先','text'],['originalAmount','借入総額（円）','number'],['remainingBalance','現在残高（円）','number'],
    ['monthlyPayment','毎月返済額（円）','number'],['interestRate','金利・年率（%・任意）','number'],
    ['borrowedDate','借入日','date'],['repaymentEndDate','返済予定日（任意）','date'],
    ['debtPurpose','借りた理由','textarea'],['debtStatus','状態','select','返済中|返済猶予|完済|その他']
  ],
  review:[['period','期間','select','weekly|monthly|yearly'],['wins','できたこと','textarea'],['issues','課題','textarea'],['nextActions','次にやること','textarea']],
  simulation:[['condition','変える条件','textarea'],['horizon','期間','select','1か月|3か月|半年|1年'],['assumptions','前提条件','textarea']]
};
const DETAIL_LABELS = Object.fromEntries(Object.values(DETAIL_FIELDS).flat().map(([key,label]) => [key,label]));
DETAIL_LABELS.referenceUrl = '関連URL';
const PROFILE_FIELDS = [
  ['name','名前','text'],['birthDate','生年月日','date'],['age','年齢','number'],['location','住まい','text'],
  ['family','家族','textarea'],['medicalHistory','既往歴','textarea'],['likes','好きなこと','textarea'],
  ['strengths','強み・実績','textarea'],['workHistory','仕事歴','textarea'],['trauma','苦労・心の傷','textarea'],
  ['values','価値観・信条','textarea'],['personality','性格・自分の傾向','textarea'],
  ['constraints','現在の制約','textarea'],['supportNeeds','必要な支援','textarea'],
  ['satisfaction','現在の満足度','text'],['notes','自由メモ','textarea']
];

const PROFILE_LABELS = Object.fromEntries(PROFILE_FIELDS.map(([id,label]) => [id,label]));
const PROFILE_REFERENCE_MAP = {
  healthItem: ['medicalHistory','constraints','supportNeeds'],
  goal: ['values','constraints'],
  habit: ['values','constraints'],
  comparison: ['values','constraints'],
  product: ['strengths','workHistory','values','constraints'],
  incomeRecord: ['workHistory','constraints'],
  debtRecord: ['constraints'],
  simulation: ['values','constraints']
};
const PROFILE_REFERENCE_COPY = {
  healthItem: '既往歴・現在の制約・必要な支援はプロフィールを正本として使います。健康・医療カードには、症状の経過や手術・治療・受診計画など、その項目固有の情報だけを記録します。',
  goal: '価値観と現在の制約はプロフィールから参照します。目標カードには、この目標固有の期限・進捗・行動だけを記録します。',
  habit: '価値観と現在の制約はプロフィールから参照します。習慣カードには、頻度と続ける基準など、この習慣固有の情報だけを記録します。',
  comparison: '価値観と現在の制約はプロフィールから参照します。ここには過去・現在・新しい理想の差分だけを記録します。',
  product: '強み・実績・仕事歴・価値観・制約はプロフィールから参照します。商品カードには顧客・課題・提供内容・検証など商品固有の情報だけを記録します。',
  incomeRecord: '仕事歴や現在の制約はプロフィールから参照します。収入カードには、収入元・金額・対象年月・確定／見込など、その収入固有の情報だけを記録します。',
  debtRecord: '現在の制約はプロフィールから参照できます。借入カードには、借入先・残高・返済額・借りた理由など、この借入固有の情報だけを記録します。',
  simulation: '価値観と現在の制約はプロフィールから参照します。シミュレーションには今回変える条件と前提だけを記録します。'
};

const validPage = next => PAGES.some(([id]) => id === next) || EXTRA_PAGES.includes(next) ? next : 'home';

function initialPage() {
  const requested = location.hash.slice(1);
  const normalized = validPage(requested);
  if (requested !== normalized) {
    history.replaceState(null, '', `${location.pathname}${location.search}#${normalized}`);
  }
  return normalized;
}

let state = createEmptyState();
let page = initialPage();
let migrationInspection = null;
let syncTimer = null;
let syncInFlight = false;
let deferredInstallPrompt = null;
let searchKind = 'all';
let lifeView = 'cards';
let wishTab = 'wanted';
let financeTab = 'income';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

function navHtml(keys = PAGES.map(item => item[0])) {
  return PAGES.filter(([id]) => keys.includes(id)).map(([id,icon,label]) =>
    `<button class="nav-link ${page===id?'active':''}" data-page="${id}"><span>${icon}</span><span>${label}</span></button>`).join('');
}

function setSidebarOpen(open) {
  const sidebar = $('#sidebar');
  const menuButton = $('#menuButton');
  const shouldOpen = Boolean(open) && window.matchMedia('(max-width:980px)').matches;
  sidebar.classList.toggle('open', shouldOpen);
  menuButton.setAttribute('aria-expanded', String(shouldOpen));
  menuButton.setAttribute('aria-label', shouldOpen ? 'メニューを閉じる' : 'メニューを開く');
  document.body.classList.toggle('menu-open', shouldOpen);
}

function setPage(next) {
  page = validPage(next);
  history.replaceState(null,'',`#${page}`);
  render();
  setSidebarOpen(false);
  window.scrollTo({top:0,behavior:'smooth'});
}

function toast(message, type = '') {
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.textContent = message;
  $('#toasts').append(element);
  setTimeout(() => element.remove(), 3800);
}

async function commit(next, message = '保存しました', { autoSync = true, rerender = false } = {}) {
  state = await saveCache(next);
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


async function refreshNotebookLM(button) {
  if (!state.settings.gasUrl || !state.settings.syncToken) {
    return toast('先に設定画面でGAS URLと同期トークンを登録してください','error');
  }
  const original = button?.textContent || 'NotebookLM用シートを更新';
  if (button) { button.disabled = true; button.textContent = '同期・分析タブ作成中…'; }
  updateChrome('syncing');
  try {
    // NotebookLMにはクラウド正本を渡すため、ボタン押下時に必ず最新状態まで同期する。
    state = await synchronize(state);
    const result = await refreshNotebookLMSheets(state);
    const count = Number(result.sheetCount || 0);
    toast(`NotebookLM用シートを${count || ''}タブ更新しました`);
    updateChrome();
    render();
    if (result.spreadsheetUrl && confirm('NotebookLM用タブを更新しました。Googleスプレッドシートを開きますか？')) {
      window.open(result.spreadsheetUrl, '_blank', 'noopener,noreferrer');
    }
  } catch (error) {
    toast(error.message || String(error), 'error');
    updateChrome();
  } finally {
    if (button) { button.disabled = false; button.textContent = original; }
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

function profileReferenceHtml(kind, { context = 'editor' } = {}) {
  const keys = PROFILE_REFERENCE_MAP[kind] || [];
  if (!keys.length) return '';
  const rows = keys.map(key => ({ key, label: PROFILE_LABELS[key] || key, value: String(state.profile[key] || '').trim() }));
  const filled = rows.filter(row => row.value);
  const focusKey = filled[0]?.key || keys[0];
  const pageClass = context === 'page' ? ' profile-reference-page' : '';
  const values = filled.length
    ? filled.map(row => `<div class="profile-reference-item"><small>${esc(row.label)}</small><p>${esc(row.value)}</p></div>`).join('')
    : `<div class="profile-reference-empty">関連するプロフィール情報はまだ未入力です。プロフィールに一度登録すれば、ここへ自動表示されます。</div>`;
  return `<section class="profile-reference${pageClass}" aria-label="プロフィールから自動参照する基本情報"><div class="profile-reference-head"><div><span class="badge profile-source">プロフィール連携</span><h3>基本情報はプロフィールから自動参照</h3><p>${esc(PROFILE_REFERENCE_COPY[kind] || '繰り返し入力せず、プロフィールを正本として参照します。')}</p></div><button class="btn small secondary" type="button" data-action="edit-profile-context" data-profile-focus="${esc(focusKey)}">プロフィールを確認・編集</button></div><div class="profile-reference-grid">${values}</div>${context === 'editor' ? '<p class="profile-reference-note">※ 上の内容はこのカードへコピー保存しません。プロフィールを修正すると、ここにも最新内容が反映されます。</p>' : ''}</section>`;
}

function goToProfileField(field = '') {
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  page = 'profile';
  history.replaceState(null,'','#profile');
  render();
  setSidebarOpen(false);
  requestAnimationFrame(() => {
    const target = field ? document.querySelector(`#p-${field}`) : document.querySelector('#profileForm');
    if (!target) return;
    target.scrollIntoView({ behavior:'smooth', block:'center' });
    if (target.matches('input,textarea,select')) target.focus({ preventScroll:true });
    const wrapper = target.closest('.field');
    wrapper?.classList.add('profile-focus');
    setTimeout(() => wrapper?.classList.remove('profile-focus'), 2200);
  });
}

function domainLabel(id) { return DOMAINS.find(domain => domain.id === id)?.label || id || 'その他'; }
function displayDate(value) {
  if (!value) return '日付なし';
  const date = new Date(`${String(value).slice(0,10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? esc(value) : new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'short',day:'numeric'}).format(date);
}
const FINANCE_RECORD_KINDS = new Set(['incomeRecord','expenseRecord','fixedCostRecord','debtRecord']);
function collectionFor(kind) { return FINANCE_RECORD_KINDS.has(kind) ? 'records' : COLLECTIONS[kind]; }
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

const HABIT_CATEGORY_META = {
  '食事': { icon:'🍽', className:'meal' },
  '運動': { icon:'↗', className:'exercise' },
  '睡眠': { icon:'☾', className:'sleep' },
  '健康管理': { icon:'♡', className:'health' },
  '学習': { icon:'✎', className:'learning' },
  '仕事': { icon:'▣', className:'work' },
  '生活': { icon:'⌂', className:'life' },
  'その他': { icon:'•', className:'other' }
};

function habitCategoryMeta(row) {
  const label = String(row?.details?.habitCategory || '').trim() || '未分類';
  return { label, ...(HABIT_CATEGORY_META[label] || { icon:'?', className:'uncategorized' }) };
}

const MEDICAL_PLAN_TYPES = new Set(['治療・手術計画','検査・受診予定']);
const MEDICAL_WISH_AREAS = new Set(['健康・身体','医療','メンタル']);

function healthItemType(row) {
  return String(row?.details?.healthItemType || '').trim() || '症状・健康管理';
}

function isMedicalPlan(row) {
  return MEDICAL_PLAN_TYPES.has(healthItemType(row));
}

function medicalPlaceWishes() {
  return activeRows(state.wishes).filter(row => row.details?.wishType === '行きたい場所' && row.details?.wishArea === '医療');
}

function wishAreaClass(value = '') {
  if (value === '医療') return 'medical';
  if (value === '健康・身体') return 'body';
  if (value === 'メンタル') return 'mental';
  if (value === '仕事・収入') return 'income';
  if (value === '家族') return 'family';
  if (value === 'その他') return 'other';
  return 'general';
}

function relatedMedicalPlaceName(id = '') {
  if (!id) return '';
  return state.wishes.find(row => row.id === id && !row.deletedAt)?.title || '';
}

function impactBadge(label, value) {
  if (!value) return '';
  const cls = value === '高' ? 'high' : value === '中' ? 'medium' : 'low';
  return `<span class="badge medical-impact impact-${cls}">${esc(label)} ${esc(value)}</span>`;
}

function medicalBalanceHtml(rows = []) {
  const active = rows.filter(row => row.details?.medicalStatus !== '完了');
  const count = (key, value) => active.filter(row => row.details?.[key] === value).length;
  const next = [...active].filter(row => row.details?.targetDate).sort((a,b)=>String(a.details.targetDate).localeCompare(String(b.details.targetDate)))[0];
  return `<div class="medical-balance card"><div class="medical-balance-head"><div><span class="badge medical-area">医療と生活のバランス</span><h3>身体・メンタル・収入への影響を一緒に見る</h3><p>各医療計画で自分が入力した負担度を整理して表示します。診断や予測ではありません。</p></div><button class="btn small secondary" data-page="income">収入画面を見る</button></div><div class="medical-balance-grid"><div><small>身体負担「高」</small><b>${count('physicalImpact','高')}件</b><span>中 ${count('physicalImpact','中')}件</span></div><div><small>メンタル負担「高」</small><b>${count('mentalImpact','高')}件</b><span>中 ${count('mentalImpact','中')}件</span></div><div><small>収入・仕事影響「高」</small><b>${count('incomeImpact','高')}件</b><span>中 ${count('incomeImpact','中')}件</span></div><div><small>次の医療予定</small><b>${next?displayDate(next.details.targetDate):'未設定'}</b><span>${next?esc(next.title):'予定日を登録すると表示'}</span></div></div></div>`;
}

function taskHtml(row) {
  const overdue = isOverdue(row);
  const habitMeta = row.kind === 'habit' ? habitCategoryMeta(row) : null;
  return `<div class="task ${overdue?'overdue':''}"><button class="task-check" data-action="done" data-kind="${esc(row.kind)}" data-id="${esc(row.id)}" aria-label="完了にする"></button><div class="task-main"><b>${esc(row.title)}</b><small>${overdue?'期限超過：':''}${esc(row.details?.dueDate || row.body || row.date || '')}</small></div><div class="task-badges">${habitMeta?`<span class="badge habit-category habit-${habitMeta.className}">${habitMeta.icon} ${esc(habitMeta.label)}</span>`:''}<span class="badge">${esc(domainLabel(row.domain))}</span></div></div>`;
}

function quickActionsHtml(placement = 'desktop') {
  return `<section class="quick-entry quick-entry-${placement}" aria-label="すぐに記録">
    ${sectionHead('すぐに記録','よく使う入力を、ここからすぐに追加できます。')}
    <div class="quick-actions">
      <button class="quick quick-record" data-action="new-record" data-kind="record"><b>＋ 日々の記録</b><small>気づき・感情・出来事</small></button>
      <button class="quick quick-health" data-action="new-record" data-kind="healthItem"><b>＋ 健康</b><small>症状・通院・測定</small></button>
      <button class="quick quick-goal" data-action="new-record" data-kind="goal"><b>＋ 目標</b><small>理想への次の一歩</small></button>
      <button class="quick quick-wish" data-action="new-record" data-kind="wish"><b>＋ 夢・楽しみ</b><small>もの・場所・挑戦・体験</small></button>
      <button class="quick quick-product" data-action="new-record" data-kind="product"><b>＋ 商品・事業</b><small>WEBRICHの種</small></button>
      <button class="quick quick-income" data-action="new-record" data-kind="incomeRecord"><b>＋ 収入</b><small>給与・年金・副収入・手当</small></button>
    </div>
  </section>`;
}

function dashboardCardHtml({page:target, icon, label, count, theme}) {
  return `<button class="dashboard-card dashboard-${esc(theme)}" data-page="${esc(target)}" aria-label="${esc(label)} ${count}件">
    <span class="dashboard-icon" aria-hidden="true">${icon}</span>
    <span class="dashboard-count">${count}</span>
    <b>${esc(label)}</b>
  </button>`;
}

function renderHome() {
  const score = calculateLifeScore(state);
  const tasks = todayTasks(state);
  const weakest = [...DOMAINS].sort((a,b) => state.scores[a.id]-state.scores[b.id])[0];
  const overdue = [...state.goals,...state.habits].filter(row => !row.deletedAt && isOverdue(row));
  const reviewNeeded = ['weekly','monthly','yearly'].filter(period => reviewDue(state,period)).length;
  const lastAI = [...state.aiHistory].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];
  const recentRecords = [...activeRows(state.records)].sort((a,b)=>new Date(b.updatedAt||b.createdAt||0)-new Date(a.updatedAt||a.createdAt||0)).slice(0,3);
  const topGoals = activeRows(state.goals).filter(row=>row.details?.goalStatus!=='達成済み' && Number(row.details?.progress||0)<100).slice(0,3);
  const profileCount = PROFILE_FIELDS.filter(([key])=>String(state.profile[key]||'').trim()).length;
  const lifeCount = activeRows(state.goals).length + activeRows(state.habits).length + activeRows(state.wishes).length + activeRows(state.comparisons).length;
  const dashboardCards = [
    {page:'profile',icon:'♙',label:'プロフィール',count:profileCount,theme:'profile'},
    {page:'life',icon:'◎',label:'人生設計',count:lifeCount,theme:'life'},
    {page:'health',icon:'♡',label:'健康',count:activeRows(state.healthItems).length,theme:'health'},
    {page:'work',icon:'▣',label:'事業',count:activeRows(state.products).length,theme:'work'},
    {page:'income',icon:'¥',label:'お金',count:financeRows().length,theme:'income'},
    {page:'timeline',icon:'⌁',label:'タイムライン',count:activeRows(state.timeline).length,theme:'timeline'},
    {page:'reviews',icon:'◷',label:'レビュー',count:activeRows(state.reviews).length,theme:'reviews'},
    {page:'ai',icon:'✦',label:'AI伴走',count:state.aiHistory.length,theme:'ai'},
    {page:'integrations',icon:'⌬',label:'AI連携',count:Number(Boolean(state.settings?.integrations?.line?.enabled))+Number(Boolean(state.settings?.integrations?.gpt?.enabled)),theme:'integrations'},
    {page:'data',icon:'⇄',label:'連携・移行',count:allRows().length,theme:'data'},
    {page:'search',icon:'⌕',label:'全体検索',count:allRows().length,theme:'search'}
  ];
  return `<div class="page-enter">
    ${quickActionsHtml('mobile')}
    <div class="home-dashboard">
      <section class="home-primary">
        <div class="home-hero">
          <div><span class="home-date">${new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short',timeZone:'Asia/Tokyo'}).format(new Date())}</span><h2>人生の現在地を、今日の一歩に変える</h2><p>${esc(state.profile.name || '相棒')}さんの記録・目標・健康・仕事を一つにつなぎ、今やることを見つけます。</p><div class="btn-row"><button class="btn" data-page="ai">AIに優先順位を聞く</button><button class="btn secondary" data-action="new-record" data-kind="record">今日を記録</button></div></div>
          <div class="home-score"><b>${score}</b><span>人生スコア</span></div>
        </div>
        <div class="dashboard-grid">${dashboardCards.map(dashboardCardHtml).join('')}</div>
      </section>
      <aside class="home-rail">
        <section class="home-panel home-panel-goals"><h2>⚑ 目標の上位</h2>${topGoals.length?topGoals.map(row=>`<button class="rail-item" data-page="life"><b>${esc(row.title)}</b><span>${Number(row.details?.progress||0)}%${row.details?.dueDate?` ・ ${displayDate(row.details.dueDate)}`:''}</span></button>`).join(''):'<div class="empty">目標はまだありません。<br><button class="btn secondary small" data-action="new-record" data-kind="goal">目標を追加</button></div>'}</section>
        <section class="home-panel home-panel-focus"><h2>◎ 今日の確認</h2><div class="focus-row"><span>いまの重点</span><b>${weakest.label}</b></div><div class="focus-row"><span>今日やること</span><b>${tasks.length}件</b></div><div class="focus-row ${overdue.length?'is-alert':''}"><span>期限超過</span><b>${overdue.length}件</b></div><div class="focus-row"><span>レビュー時期</span><b>${reviewNeeded}件</b></div></section>
      </aside>
    </div>
    <div class="home-lower-grid">
      <section><div class="section-head compact"><div><h2>◷ 最近の記録</h2><p>直近の記録をすぐ確認できます。</p></div><button class="btn ghost small" data-page="search">すべて探す</button></div><div class="card">${recentRecords.length?recentRecords.map(row=>recordCard(row,'record')).join(''):'<div class="empty">まだ記録がありません。まずは今日の出来事から書いてみましょう。</div>'}</div></section>
      <section><div class="section-head compact"><div><h2>✦ AIからの問い</h2><p>登録データを横断して整理します。</p></div></div><div class="card ai-box"><p>いま一番変えると、人生全体に良い影響が広がるものは何か？</p><button class="btn" data-action="quick-ai">横断分析する</button>${lastAI?`<p class="ai-result">${esc(lastAI.answer).slice(0,340)}${lastAI.answer.length>340?'…':''}</p>`:'<div class="empty">最初の横断分析を行うと、ここに要点が表示されます。</div>'}</div></section>
    </div>
    ${quickActionsHtml('desktop')}
  </div>`;
}

function scoreGuideHtml() {
  const levels = [
    ['0〜20','かなり不満','早めに見直したい状態'],
    ['21〜40','課題が多い','困りごとが目立つ状態'],
    ['41〜60','普通・中間','良い点と課題が半々'],
    ['61〜80','おおむね満足','さらに伸ばしたい状態'],
    ['81〜100','非常に満足','理想にかなり近い状態']
  ];
  return `<details class="score-guide"><summary>点数の基準</summary><div class="score-guide-body"><p><b>この点数は自動診断ではなく、自分自身が感じる現在の満足度を0〜100で付ける自己評価です。</b> 初期値は全項目50点です。ホームの「人生スコア」は8項目の単純平均で、登録件数やAIが勝手に加点・減点する仕組みではありません。</p><div class="score-scale">${levels.map(([range,title,note])=>`<div><strong>${range}</strong><b>${title}</b><small>${note}</small></div>`).join('')}</div><p class="score-guide-note">同じ基準で定期的に付け直すと、「何点か」よりも「前回からどう変わったか」が分かります。</p></div></details>`;
}

function mindMapLeaf(row, kind) {
  const sub = kind==='goal' && row.details?.progress!==undefined ? `${Number(row.details.progress||0)}%`
    : kind==='habit' ? habitCategoryMeta(row).label
    : kind==='wish' && row.details?.wishArea ? row.details.wishArea : '';
  return `<button class="mindmap-leaf" data-action="view-record" data-kind="${esc(kind)}" data-id="${esc(row.id)}" title="${esc(row.title)}を開く"><span>${esc(row.title)}</span>${sub?`<small>${esc(sub)}</small>`:''}</button>`;
}

function mindMapBranch({label, icon, rows, kind, theme}) {
  const items = rows.slice(0, 6);
  return `<section class="mindmap-branch mindmap-${esc(theme)}"><h3><span>${icon}</span>${esc(label)}<b>${rows.length}</b></h3><div class="mindmap-leaves">${items.length?items.map(row=>mindMapLeaf(row,kind)).join(''):'<span class="mindmap-empty">まだ登録がありません</span>'}${rows.length>items.length?`<span class="mindmap-more">ほか ${rows.length-items.length}件</span>`:''}</div></section>`;
}

function renderLifeMindMap({wantedItems,wantedPlaces,wantedExperiences}) {
  const goals = activeRows(state.goals);
  const habits = activeRows(state.habits);
  const comparisons = activeRows(state.comparisons);
  const left = [
    {label:'目標',icon:'⚑',rows:goals,kind:'goal',theme:'goals'},
    {label:'習慣',icon:'↻',rows:habits,kind:'habit',theme:'habits'},
    {label:'理想との比較',icon:'◇',rows:comparisons,kind:'comparison',theme:'comparison'}
  ];
  const right = [
    {label:'欲しいもの',icon:'◈',rows:wantedItems,kind:'wish',theme:'wanted'},
    {label:'行きたい場所',icon:'⌖',rows:wantedPlaces,kind:'wish',theme:'places'},
    {label:'やりたいこと',icon:'✦',rows:wantedExperiences,kind:'wish',theme:'experiences'}
  ];
  const total = [...left,...right].reduce((sum,item)=>sum+item.rows.length,0);
  return `<section class="mindmap-panel" aria-label="人生設計マインドマップ"><div class="mindmap-caption"><div><h2>人生マインドマップ</h2><p>中心から目標・習慣・夢へつながる全体像です。項目を押すと詳細を確認できます。</p></div><span>${total}件</span></div><div class="mindmap-canvas"><div class="mindmap-side mindmap-left">${left.map(mindMapBranch).join('')}</div><div class="mindmap-center-wrap"><div class="mindmap-center-node"><span>LC</span><b>Life Compass</b><small>人生設計</small></div></div><div class="mindmap-side mindmap-right">${right.map(mindMapBranch).join('')}</div></div></section>`;
}

function wishTabsHtml(counts) {
  const tabs = [
    ['wanted','欲しいもの','◈',counts.wanted],
    ['place','行きたい場所','⌖',counts.place],
    ['experience','やりたいこと','✦',counts.experience]
  ];
  return `<div class="wish-mobile-tabs" role="tablist" aria-label="夢・楽しみの種類">${tabs.map(([id,label,icon,count])=>`<button class="${wishTab===id?'active':''}" data-wish-tab="${id}" role="tab" aria-selected="${wishTab===id}"><span>${icon}</span><b>${label}</b><small>${count}件</small></button>`).join('')}</div>`;
}

function renderLife() {
  const wantedItems = activeRows(state.wishes).filter(row => (row.details?.wishType || '欲しいもの') === '欲しいもの');
  const wantedPlaces = activeRows(state.wishes).filter(row => row.details?.wishType === '行きたい場所');
  const wantedExperiences = activeRows(state.wishes).filter(row => row.details?.wishType === 'やってみたいこと・挑戦・体験');
  const lifeData = {wantedItems,wantedPlaces,wantedExperiences};
  const cards = `${sectionHead('理想との比較','過去の理想 → 現在 → 新しい理想を専用項目で整理','<button class="btn secondary" data-action="new-record" data-kind="comparison">＋ 比較を追加</button>')}${recordList(state.comparisons,'comparison')}
  ${sectionHead('目標と習慣','期限・進捗・頻度に加え、習慣は食事・運動など種類別に管理','<div class="btn-row"><button class="btn secondary" data-action="new-record" data-kind="goal">＋ 目標</button><button class="btn secondary" data-action="new-record" data-kind="habit">＋ 習慣</button></div>')}
  <div class="grid grid-2"><div class="card"><h3>目標</h3>${duplicateSummaryHtml(state.goals,'goal')}${activeRows(state.goals).map(taskHtml).join('')||'<div class="empty">目標はまだありません</div>'}</div><div class="card"><h3>習慣</h3>${duplicateSummaryHtml(state.habits,'habit')}${activeRows(state.habits).map(taskHtml).join('')||'<div class="empty">習慣はまだありません</div>'}</div></div>
  ${sectionHead('夢・楽しみ','欲しいもの・場所・やりたいことに加え、一般／健康・身体／医療／メンタルなど分野も選べます。','<button class="btn secondary" data-action="new-record" data-kind="wish">＋ 夢・楽しみを追加</button>')}
  ${wishTabsHtml({wanted:wantedItems.length,place:wantedPlaces.length,experience:wantedExperiences.length})}
  <div class="grid grid-3 wish-grid"><section class="wish-group wish-wanted ${wishTab==='wanted'?'mobile-active':''}" data-wish-panel="wanted"><h3>欲しいもの</h3><p>手に入れたい物や暮らしの道具</p>${duplicateSummaryHtml(wantedItems,'wish')}${wantedItems.length?`<div class="record-list">${wantedItems.map(row=>recordCard(row,'wish')).join('')}</div>`:'<div class="empty">欲しいものはまだありません</div>'}</section><section class="wish-group wish-place ${wishTab==='place'?'mobile-active':''}" data-wish-panel="place"><h3>行きたい場所</h3><p>旅先、店、施設、訪れたい地域</p>${duplicateSummaryHtml(wantedPlaces,'wish')}${wantedPlaces.length?`<div class="record-list">${wantedPlaces.map(row=>recordCard(row,'wish')).join('')}</div>`:'<div class="empty">行きたい場所はまだありません</div>'}</section><section class="wish-group wish-experience ${wishTab==='experience'?'mobile-active':''}" data-wish-panel="experience"><h3>やってみたいこと・挑戦・体験</h3><p>成長のための挑戦から、純粋に楽しむ体験まで</p>${duplicateSummaryHtml(wantedExperiences,'wish')}${wantedExperiences.length?`<div class="record-list">${wantedExperiences.map(row=>recordCard(row,'wish')).join('')}</div>`:'<div class="empty">やってみたいことはまだありません</div>'}</section></div>`;
  return `<div class="page-enter">${sectionHead('人生レーダー','自分で付ける現在の満足度です。初期値は50点、人生スコアは8項目の平均です。','<button class="btn" data-action="save-scores">点数を保存</button>')}
  <div class="card radar-wrap">${radarSvg()}<div class="score-editor">${DOMAINS.map(domain=>`<div class="score-row"><label>${domain.label}</label><input type="range" min="0" max="100" value="${state.scores[domain.id]}" data-score="${domain.id}" aria-label="${domain.label}の自己評価"><output>${state.scores[domain.id]}</output></div>`).join('')}</div></div>
  ${scoreGuideHtml()}
  <div class="life-view-switch" role="tablist" aria-label="人生設計の表示方法"><button class="${lifeView==='cards'?'active':''}" data-life-view="cards" role="tab" aria-selected="${lifeView==='cards'}">▦ カード表示</button><button class="${lifeView==='mindmap'?'active':''}" data-life-view="mindmap" role="tab" aria-selected="${lifeView==='mindmap'}">⌘ マインドマップ</button></div>
  ${lifeView==='mindmap'?renderLifeMindMap(lifeData):cards}</div>`;
}

function renderHealth() {
  const healthRows = activeRows(state.healthItems);
  const medicalPlans = healthRows.filter(isMedicalPlan);
  const regularHealth = healthRows.filter(row => !isMedicalPlan(row));
  const medicalWishes = activeRows(state.wishes).filter(row => MEDICAL_WISH_AREAS.has(String(row.details?.wishArea || '')));
  const medicalWanted = medicalWishes.filter(row => (row.details?.wishType || '欲しいもの') === '欲しいもの');
  const medicalPlaces = medicalWishes.filter(row => row.details?.wishType === '行きたい場所' && row.details?.wishArea === '医療');
  const medicalExperiences = medicalWishes.filter(row => row.details?.wishType === 'やってみたいこと・挑戦・体験');
  return `<div class="page-enter"><div class="hero"><div class="hero-grid"><div><span class="badge">HEALTH & MEDICAL COMPASS</span><h2>健康の記録と、これからの医療計画を分けて整理。</h2><p>既往歴はプロフィールを正本にし、症状の経過、手術・治療・検査の予定、病院候補、身体・メンタル・収入への影響を一つにつなぎます。</p><div class="btn-row"><button class="btn secondary" data-action="new-record" data-kind="healthItem" data-health-type="症状・健康管理">＋ 健康項目</button><button class="btn" data-action="new-record" data-kind="healthItem" data-health-type="治療・手術計画">＋ 手術・治療計画</button></div></div><div class="life-score">${state.scores.health}<small>HEALTH</small></div></div></div>
  ${sectionHead('健康の基本情報','既往歴などはプロフィールを正本として自動参照します。ここで同じ内容を入力し直す必要はありません。')}${profileReferenceHtml('healthItem',{context:'page'})}
  ${sectionHead('現在の健康・メンタル','症状、血圧、視力、腰、日々の健康管理やメンタルの変化を記録','<div class="btn-row"><button class="btn secondary" data-action="new-record" data-kind="healthItem" data-health-type="症状・健康管理">＋ 症状・健康</button><button class="btn secondary" data-action="new-record" data-kind="healthItem" data-health-type="メンタル">＋ メンタル</button></div>')}${recordList(regularHealth,'healthItem')}
  ${sectionHead('医療計画','将来の手術・治療・検査・受診を、予定日や負担まで含めて管理','<div class="btn-row"><button class="btn" data-action="new-record" data-kind="healthItem" data-health-type="治療・手術計画">＋ 手術・治療</button><button class="btn secondary" data-action="new-record" data-kind="healthItem" data-health-type="検査・受診予定">＋ 検査・受診</button></div>')}${medicalPlans.length?recordList(medicalPlans,'healthItem'):'<div class="empty">医療計画はまだありません。将来予定している手術や検査をここへ追加できます。</div>'}
  ${medicalBalanceHtml(medicalPlans)}
  ${sectionHead('医療に関する「欲しい・行きたい・やりたい」','人生設計で「分野＝医療／健康・身体／メンタル」にした項目を自動表示します。同じ内容を二重登録しません。','<button class="btn secondary" data-page="life">人生設計で全件を見る</button>')}
  <div class="grid grid-3 medical-wish-grid"><section class="wish-group wish-wanted"><h3>医療・健康で欲しいもの</h3><p>レンズ、補助具、治療に必要な物など</p><button class="btn small secondary" data-action="new-record" data-kind="wish" data-wish-type="欲しいもの" data-wish-area="医療">＋ 追加</button>${medicalWanted.length?`<div class="record-list">${medicalWanted.map(row=>recordCard(row,'wish')).join('')}</div>`:'<div class="empty">まだありません</div>'}</section><section class="wish-group wish-place"><h3>病院・クリニック候補</h3><p>受診したい病院、専門クリニック、セカンドオピニオン先</p><button class="btn small secondary" data-action="new-record" data-kind="wish" data-wish-type="行きたい場所" data-wish-area="医療">＋ 病院・クリニック</button>${medicalPlaces.length?`<div class="record-list">${medicalPlaces.map(row=>recordCard(row,'wish')).join('')}</div>`:'<div class="empty">まだありません</div>'}</section><section class="wish-group wish-experience"><h3>受けたい治療・検査・医療体験</h3><p>情報収集中の治療、検査、相談したいことなど</p><button class="btn small secondary" data-action="new-record" data-kind="wish" data-wish-type="やってみたいこと・挑戦・体験" data-wish-area="医療">＋ 追加</button>${medicalExperiences.length?`<div class="record-list">${medicalExperiences.map(row=>recordCard(row,'wish')).join('')}</div>`:'<div class="empty">まだありません</div>'}</section></div>
  ${sectionHead('健康・医療AIサポート','医療診断は行いません。医療計画・身体負担・メンタル負担・収入への影響を整理します。')}${aiComposer('health','プロフィールの既往歴、現在の健康項目、手術・治療・検査の医療計画、医療分野の欲しいもの・病院候補・やりたいこと、収入記録を重複なく参照してください。診断はせず、事実と未確定情報を分け、身体への負担、メンタルへの負担、収入・仕事への影響、医師に確認すること、今準備することを整理してください。')}</div>`;
}

function financeRows(kind = '') {
  const rows = activeRows(state.records).filter(row => FINANCE_RECORD_KINDS.has(row.kind) || row.domain === 'income');
  if (!kind) return rows;
  if (kind === 'incomeRecord') return rows.filter(row => row.kind === 'incomeRecord' || (!FINANCE_RECORD_KINDS.has(row.kind) && row.domain === 'income'));
  return rows.filter(row => row.kind === kind);
}

function incomeRows() { return financeRows('incomeRecord'); }
function expenseRows() { return financeRows('expenseRecord'); }
function fixedCostRows() { return financeRows('fixedCostRecord'); }
function debtRows() { return financeRows('debtRecord'); }

function moneyNumber(value) {
  const raw = String(value ?? '').replace(/[，,￥¥\s]/g,'');
  const number = Number(raw);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function incomeAmount(row) { return moneyNumber(row?.details?.amount); }
function incomeYen(value) { const amount=Math.round(Number(value||0)); return amount < 0 ? `-¥${Math.abs(amount).toLocaleString('ja-JP')}` : `¥${amount.toLocaleString('ja-JP')}`; }

function monthlyFixedCost(row) {
  const amount = moneyNumber(row?.details?.amount);
  const factor = {'毎月':1,'2か月ごと':0.5,'半年':1/6,'毎年':1/12}[row?.details?.fixedCostFrequency || '毎月'] ?? 1;
  return row?.details?.fixedCostStatus === '終了' ? 0 : amount * factor;
}

function financeTabsHtml(counts) {
  const tabs = [
    ['income','収入','¥',counts.income],['expense','支出','−',counts.expense],
    ['fixed','固定費','⌂',counts.fixed],['debt','負債・借入','↘',counts.debt]
  ];
  return `<div class="finance-tabs" role="tablist" aria-label="お金の記録種類">${tabs.map(([id,label,icon,count])=>`<button class="${financeTab===id?'active':''}" data-finance-tab="${id}" role="tab" aria-selected="${financeTab===id}"><span>${icon}</span><b>${label}</b><small>${count}件</small></button>`).join('')}</div>`;
}

function financePanel(kind, title, copy, buttonLabel, rows) {
  const sorted = [...rows].sort((a,b)=>new Date(b.date||b.updatedAt||0)-new Date(a.date||a.updatedAt||0));
  return `<section class="finance-panel">${sectionHead(title,copy,`<button class="btn" data-action="new-record" data-kind="${kind}">＋ ${buttonLabel}</button>`)}${recordList(sorted,kind)}</section>`;
}

function renderWork() {
  return `<div class="page-enter"><div class="grid grid-2"><div class="card metric-card"><span class="metric-icon">▣</span><div><small>仕事スコア</small><b>${state.scores.work}</b></div></div><div class="card metric-card"><span class="metric-icon">◇</span><div><small>事業アイデア</small><b>${activeRows(state.products).length}</b></div></div></div>
  ${sectionHead('商品・事業の種','事業・商品開発だけをここで管理します。収入・支出・固定費・負債は「お金」画面へ分離しました。','<div class="btn-row"><button class="btn" data-action="new-record" data-kind="product">＋ 事業・商品を追加</button><button class="btn secondary" data-page="income">お金を見る</button></div>')}${recordList(state.products,'product')}
  ${sectionHead('経営・商品AI','実用性・販売可能性・次の検証まで客観的に分析')}${aiComposer('business','人生経験と現在の商品案を横断し、実用性・販売可能性・次の検証を客観的に分析してください。')}</div>`;
}

function renderIncome() {
  const incomes = incomeRows();
  const expenses = expenseRows();
  const fixed = fixedCostRows();
  const debts = debtRows();
  const month = localDateKey().slice(0,7);
  const thisMonthIncome = incomes.filter(row => String(row.details?.incomePeriod || row.date || '').slice(0,7) === month);
  const confirmedIncome = thisMonthIncome.filter(row => !['見込','未入金'].includes(String(row.details?.incomeStatus || '確定'))).reduce((sum,row)=>sum+incomeAmount(row),0);
  const thisMonthExpense = expenses.filter(row => String(row.details?.expensePeriod || row.date || '').slice(0,7) === month && String(row.details?.expenseStatus || '確定') !== '予定').reduce((sum,row)=>sum+moneyNumber(row.details?.amount),0);
  const monthlyFixed = fixed.reduce((sum,row)=>sum+monthlyFixedCost(row),0);
  const activeDebts = debts.filter(row => String(row.details?.debtStatus || '返済中') !== '完済');
  const debtBalance = activeDebts.reduce((sum,row)=>sum+moneyNumber(row.details?.remainingBalance || row.details?.originalAmount),0);
  const monthlyDebt = activeDebts.reduce((sum,row)=>sum+moneyNumber(row.details?.monthlyPayment),0);
  const roughMargin = confirmedIncome - thisMonthExpense - monthlyFixed - monthlyDebt;
  const panels = {
    income: financePanel('incomeRecord','収入記録','給与・年金・副収入・給付・配当など、入ってくるお金を記録します。','収入を追加',incomes),
    expense: financePanel('expenseRecord','支出記録','家計簿のように細かく記録せず、医療費・大きな買い物・税金など把握したい支出だけでOKです。','支出を追加',expenses),
    fixed: financePanel('fixedCostRecord','固定費','毎月・毎年ほぼ決まって出ていく費用を登録します。金額の見直し候補も残せます。','固定費を追加',fixed),
    debt: financePanel('debtRecord','負債・借入','どこから、いくら借り、残りはいくらで、毎月いくら返しているか。借りた理由も一緒に残します。','負債・借入を追加',debts)
  };
  return `<div class="page-enter">
    <div class="hero income-hero"><div class="hero-grid"><div><span class="badge">MONEY COMPASS</span><h2>事業とは分けて、お金の全体像だけを把握。</h2><p>収入・支出・固定費・負債を、人生設計に必要な粒度で記録します。家計簿のような1円単位の管理は目的にしません。</p><div class="btn-row"><button class="btn" data-action="new-record" data-kind="incomeRecord">＋ 収入</button><button class="btn secondary" data-action="new-record" data-kind="debtRecord">＋ 負債・借入</button></div></div><div class="life-score">${state.scores.income}<small>MONEY</small></div></div></div>
    <div class="grid grid-4 finance-metrics">
      <div class="card metric-card"><span class="metric-icon">¥</span><div><small>今月の確定収入</small><b>${incomeYen(confirmedIncome)}</b></div></div>
      <div class="card metric-card"><span class="metric-icon">⌂</span><div><small>月あたり固定費</small><b>${incomeYen(monthlyFixed)}</b></div></div>
      <div class="card metric-card"><span class="metric-icon">↘</span><div><small>毎月の返済額</small><b>${incomeYen(monthlyDebt)}</b></div></div>
      <div class="card metric-card"><span class="metric-icon">▤</span><div><small>負債の現在残高</small><b>${incomeYen(debtBalance)}</b></div></div>
    </div>
    <section class="card finance-balance-card"><div><span class="badge blue">ざっくり生活余力</span><h3>${incomeYen(roughMargin)}</h3><p>今月の確定収入 − 今月の登録支出 − 月換算固定費 − 毎月返済額。家計簿ではないため参考値です。</p></div><div class="finance-balance-breakdown"><span>今月支出 <b>${incomeYen(thisMonthExpense)}</b></span><span>固定費 <b>${incomeYen(monthlyFixed)}</b></span><span>返済 <b>${incomeYen(monthlyDebt)}</b></span></div></section>
    <div class="finance-note"><b>二重計上を避けるコツ</b><span>固定費と借入返済は専用欄へ。支出には、固定費・返済以外の大きな支出や把握したい支出を登録してください。</span></div>
    ${financeTabsHtml({income:incomes.length,expense:expenses.length,fixed:fixed.length,debt:debts.length})}
    <div class="finance-tab-content">${panels[financeTab] || panels.income}</div>
    ${sectionHead('お金AI','収入・支出・固定費・負債を人生設計の観点で整理。家計簿の細かな節約診断ではありません。')}${aiComposer('income','収入・支出・固定費・負債（借入）とプロフィール、医療計画を横断してください。収入の安定性、毎月の固定負担、返済負担、医療や生活上の大きな支出予定を整理し、事実と推測を分けて、無理が出そうな点と現実的な改善余地を示してください。家計簿の1円単位の最適化は不要です。')}
  </div>`;
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
  return `<div class="page-enter"><div class="card profile-master-card" style="margin-bottom:16px"><span class="badge">AI BASE DATA</span><h2>プロフィールは「基本情報の正本」です</h2><p>既往歴・仕事歴・強み・価値観・現在の制約など、何度も使う情報はここに一度だけ登録します。健康・目標・商品などの画面は、このプロフィールを自動参照するため、同じ内容を何度も入力する必要はありません。</p></div><form id="profileForm" class="card form-grid">${PROFILE_FIELDS.map(([id,label,type])=>`<div class="field ${type==='textarea'?'full':''}"><label for="p-${id}">${label}</label>${type==='textarea'?`<textarea id="p-${id}" name="${id}">${esc(state.profile[id])}</textarea>`:`<input id="p-${id}" name="${id}" type="${type}" value="${esc(state.profile[id])}">`}</div>`).join('')}<div class="field full"><div class="btn-row"><button class="btn" type="submit">プロフィールを保存</button><span class="badge">各画面から自動参照・項目単位で同期</span></div></div></form></div>`;
}

function renderData() {
  const synced = Boolean(state.meta.lastSyncedAt);
  const trash = allRows({deleted:true});
  const counts = [['記録',state.records],['目標',state.goals],['習慣',state.habits],['夢・楽しみ',state.wishes],['健康',state.healthItems],['タイムライン',state.timeline],['人生比較',state.comparisons],['商品',state.products],['レビュー',state.reviews],['シミュレーション',state.simulations]];
  return `<div class="page-enter"><div class="grid grid-2"><section class="card"><h2>クラウド同期</h2><div class="status-panel"><span class="status-dot ${synced?'ok':'warn'}"></span><div><b>${synced?'同期済み':'初回同期前'}</b><small style="display:block;color:var(--muted)">${synced?new Date(state.meta.lastSyncedAt).toLocaleString('ja-JP'):'設定で接続情報を登録してください'}</small></div></div><p>Google Sheetsを正本として、プロフィールも点数も項目単位で安全に統合します。</p><div class="btn-row"><button class="btn" data-action="sync">今すぐ同期</button><button class="btn ghost" data-action="test-connection">接続テスト</button></div></section>
  <section class="card"><h2>JSONバックアップ</h2><p>全データを手元に保存します。復元や端末移行に使えます。</p><div class="btn-row"><button class="btn secondary" data-action="export-json">JSONを書き出す</button><button class="btn ghost" data-action="import-json">旧JSONを比較・統合</button></div></section></div>
  ${sectionHead('NotebookLM連携','Google Sheets内にNotebookLM専用の読み取りやすい分析タブを自動生成')}
  <section class="card notebooklm-card"><div class="notebooklm-head"><div><span class="badge blue">NOTEBOOKLM READY</span><h2>人生データをNotebookLM向けに整理</h2><p>最初にクラウド同期し、その正本からプロフィール・健康／医療・収入／支出／固定費／負債・目標／習慣・夢・事業・タイムライン・レビューを専用タブへ再構成します。同じ情報をもう一度入力する必要はありません。</p></div><div class="notebooklm-icon">N</div></div><div class="notebooklm-steps"><div><b>1</b><span>Life Compassを同期</span></div><div><b>2</b><span>NotebookLM用タブを更新</span></div><div><b>3</b><span>同じGoogleスプレッドシートをNotebookLMのソースに追加</span></div></div><div class="btn-row"><button class="btn" data-action="refresh-notebooklm">NotebookLM用シートを更新</button><button class="btn ghost" data-action="export-notebook">Markdownでも書き出す</button></div><p class="fine-print">更新すると NLM_00_Overview ～ NLM_10_All_Index を再生成します。Life Compassの正本シートは削除・変更しません。健康・医療・収入・支出・負債などセンシティブな情報を含むため、NotebookLM側の共有範囲には注意してください。</p></section>
  ${sectionHead('その他の外部連携','同じ人生データを目的別に再利用')}
  <div class="quick-actions"><button class="quick" data-page="integrations"><b>LINE・相棒専用GPT</b><small>AI連携センターを開く</small></button><button class="quick" data-action="export-story"><b>Story Studio</b><small>人生資産を書き出す</small></button><button class="quick" data-action="export-product"><b>商品設計</b><small>経験を商品へ送る</small></button><button class="quick" data-action="export-kotka"><b>KOTKA AI経営OS</b><small>事業データを書き出す</small></button></div>
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

function isCustomGptUrl(value = '') {
  try {
    const url = new URL(String(value).trim());
    const allowedHost = ['chatgpt.com','www.chatgpt.com','chat.openai.com'].includes(url.hostname.toLowerCase());
    return allowedHost && /^\/g\/[^/]+/i.test(url.pathname);
  } catch (_) { return false; }
}

function aiProviderLabel(value = state.settings.provider) {
  return value === 'openai' ? 'ChatGPT GPT-5.4 mini' : 'Gemini 2.5 Flash';
}

function renderIntegrations() {
  const integrations = state.settings.integrations;
  const line = integrations.line;
  const gpt = integrations.gpt;
  const cost = estimateGeminiCost(integrations.cost);
  const currentAiLabel = aiProviderLabel();
  const gptUrlReady = isCustomGptUrl(gpt.gptUrl);
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
      <div class="integration-title"><div><span class="status-dot ${line.connected?'ok':'warn'}"></span><div><h3>相棒専用LINE伴走ボット</h3><p>${line.connected?'接続済み':'未接続・Life Compass単体で通常利用できます'}</p></div></div><label class="switch" data-integration-switch="line"><input id="lineEnabled" type="checkbox" ${line.enabled?'checked':''} aria-label="LINE連携準備を切り替える"><span></span><b data-switch-text>${line.enabled?'準備ON':'準備OFF'}</b></label></div>
      <div class="form-grid compact-grid"><div class="field"><label>通常回答AI</label><select id="lineProvider"><option value="gemini" selected>Gemini 2.5 Flash</option></select></div><div class="field"><label>1日あたりの上限</label><input id="lineDailyLimit" type="number" min="1" max="100" value="${Number(line.dailyLimit||10)}"></div></div>
      <div class="toggle-row"><label class="toggle-card"><input id="lineSaveHistory" type="checkbox" ${line.saveHistory?'checked':''}> LINE会話をLife Compassへ保存</label><label class="toggle-card"><input id="lineOwnerOnly" type="checkbox" ${line.ownerOnly?'checked':''}> 相棒のLINEユーザーIDだけ許可</label></div>
      <h4>LINEへ渡してよいデータ</h4>${scopeGrid('line')}
    </section>

    ${sectionHead('相棒専用GPT','知識ファイルと指示文を使って、自分専用のGPTを作成します')}
    <section class="card integration-card">
      <div class="ai-usage-summary" aria-label="現在のAI利用状況">
        <div><small>Life Compass内のAI伴走</small><b>${esc(currentAiLabel)}</b><span>AI伴走画面の「AIモデル」で変更</span></div>
        <div class="${gpt.enabled?'active':'inactive'}"><small>相棒専用GPT</small><b>${gpt.enabled?'利用ON':'利用OFF'}</b><span>${gptUrlReady?'専用リンク登録済み':'専用リンク未登録'}</span></div>
      </div>
      <div class="integration-title"><div><span class="status-dot ${gptUrlReady?'ok':'warn'}"></span><div><h3>ChatGPT Plus｜非公開GPT</h3><p>${gptUrlReady?'相棒専用GPTのリンクを登録済み':'まだ作成していません。まず知識ファイルと指示文を書き出します'}</p></div></div><label class="switch" data-integration-switch="gpt"><input id="gptEnabled" type="checkbox" ${gpt.enabled?'checked':''} aria-label="相棒専用GPTの利用を切り替える"><span></span><b data-switch-text>${gpt.enabled?'利用ON':'利用OFF'}</b></label></div>
      <div class="integration-explainer"><b>このスイッチは、Life Compass内で使うAIモデルの選択ではありません。</b><p>ONにすると「相棒専用GPTを使う設定」が有効になります。Life Compass内のAI伴走でGeminiとChatGPTを切り替える場合は、AI伴走画面の「AIモデル」を使います。</p></div>
      <div class="form-grid compact-grid"><div class="field full"><label>相棒専用GPTのリンク（GPT作成後に貼り付け）</label><input id="gptUrl" type="url" value="${esc(gpt.gptUrl||'')}" placeholder="https://chatgpt.com/g/..."><span class="hint">通常の会話共有URLではありません。chatgpt.com/g/ で始まる「GPT本体のリンク」を入力します。</span></div></div>
      <div class="gpt-steps"><h4>URLの作り方・使い方</h4><ol><li>下の「① 知識ファイル」と「② GPT指示文」を書き出す</li><li>ChatGPTのGPT作成画面で、知識ファイルを追加し、指示文を貼り付ける</li><li>公開範囲を「自分のみ」にして保存し、GPTのリンクをコピーする</li><li>そのリンクを上の欄に貼り付けて「AI連携設定を保存」を押す</li><li>「相棒専用GPTを開く」から、Life Compassの内容を踏まえた深い相談をする</li></ol></div>
      <label class="toggle-card"><input id="gptUseActions" type="checkbox" ${gpt.useActions?'checked':''}> GPT Actions接続を将来使うための準備設定</label>
      <p class="fine-print action-warning">このチェックだけでは最新データ連携は始まりません。安全なAPI中継先とActions設定を別途完成させた後に有効になります。</p>
      <div class="privacy-notice"><b>非公開が前提です</b><p>振り返り・健康・家族・住所・金銭・AI履歴は初期状態でOFFです。必要な項目だけ自分で許可してください。</p></div>
      <h4>非公開GPTへ渡してよいデータ</h4>${scopeGrid('gpt')}
      <div class="btn-row integration-actions"><button class="btn" data-action="export-gpt-knowledge">① 知識ファイル</button><button class="btn secondary" data-action="export-gpt-instructions">② GPT指示文</button><button class="btn ghost" data-action="export-gpt-actions">③ Actionsひな形</button><button class="btn ghost" data-action="open-private-gpt">${gptUrlReady?'相棒専用GPTを開く':'ChatGPTのGPT一覧を開く'}</button></div>
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

const DUPLICATE_CHECK_KINDS = new Set(['goal','habit','wish','healthItem','timeline','comparison','product','fixedCostRecord','debtRecord']);
const duplicateCheckEnabled = kind => DUPLICATE_CHECK_KINDS.has(kind);

function duplicateSummaryHtml(rows, kind) {
  if (!duplicateCheckEnabled(kind)) return '';
  const pairs = findDuplicatePairs(activeRows(rows), kind).slice(0, 4);
  if (!pairs.length) return '';
  return `<div class="duplicate-summary" role="status"><div class="duplicate-summary-head"><span>⚠</span><div><b>重複している可能性があります</b><small>${pairs.length}組の候補を検出しました。自動削除はしません。</small></div></div><div class="duplicate-pairs">${pairs.map(pair=>`<div class="duplicate-pair"><div><b>${esc(pair.first.title)}</b><span>⇄</span><b>${esc(pair.second.title)}</b><small>${esc(pair.reasons.join('・'))}</small></div><button class="btn small ghost" data-action="view-record" data-kind="${esc(kind)}" data-id="${esc(pair.second.id)}">確認</button></div>`).join('')}</div></div>`;
}

function duplicateCandidateFromForm(form, kind, details = {}) {
  const data = new FormData(form);
  return {
    title: String(data.get('title') || '').trim(),
    body: String(data.get('body') || '').trim(),
    tags: String(data.get('tags') || ''),
    details: kind === 'wish' ? { ...details, wishType:String(data.get('detail__wishType') || details.wishType || '欲しいもの') } : details
  };
}

function duplicateEditorWarningHtml(matches = []) {
  if (!matches.length) return '';
  return `<div class="duplicate-editor-warning" role="alert"><div class="duplicate-editor-title"><span>⚠</span><div><b>似た登録がすでにあります</b><small>同じ内容を二重登録しないか確認してください。</small></div></div>${matches.slice(0,3).map(match=>`<div class="duplicate-editor-match"><div><b>${esc(match.row.title)}</b><small>${esc(match.reasons.join('・'))}</small></div><span>${match.score}%</span></div>`).join('')}<p>別の内容なら、そのまま保存できます。</p></div>`;
}

function recordList(rows, kind, wrap = true) {
  const active = activeRows(rows);
  const html = active.length ? `${duplicateSummaryHtml(active,kind)}${active.map(row => recordCard(row,kind)).join('')}` : '<div class="empty">まだ記録がありません</div>';
  return wrap ? `<div class="record-list">${html}</div>` : html;
}

function referenceLinksHtml(details = {}, compact = false) {
  const links = normalizeReferenceLinks(details);
  if (!links.length) return '';
  return `<div class="reference-links ${compact?'compact':''}">${links.map(link => `<a class="reference-link" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">↗ ${esc(link.label)}</a>`).join('')}</div>`;
}

function referenceLinkEditorRow(link = {}) {
  return `<div class="reference-link-row" data-reference-row><input type="text" data-reference-label value="${esc(link.label || '')}" placeholder="名前（例：公式サイト、YouTube）" maxlength="40"><input type="text" inputmode="url" data-reference-url value="${esc(link.url || '')}" placeholder="https://example.com または example.com" autocapitalize="off" autocomplete="off" spellcheck="false"><button class="icon-btn subtle reference-remove" type="button" data-remove-reference aria-label="このリンクを削除">×</button></div>`;
}

function wishTypeClass(value = '') {
  if (value === '行きたい場所') return 'wish-place';
  if (value === 'やってみたいこと・挑戦・体験') return 'wish-experience';
  return 'wish-wanted';
}

function recordCard(row, fallbackKind) {
  const kind = row.kind || fallbackKind;
  const progress = kind === 'goal' && row.details?.progress !== undefined ? Number(row.details.progress) : null;
  const completed = (kind === 'wish' && row.details?.wishStatus === '実現済み')
    || (kind === 'goal' && (row.details?.goalStatus === '達成済み' || progress >= 100 || row.status === 'done'));
  const completionLabel = kind === 'wish' ? '実現済み' : '達成済み';
  const wishClass = kind === 'wish' ? wishTypeClass(row.details?.wishType) : '';
  const attachments = Array.isArray(row.details?.attachments) ? row.details.attachments : [];
  const financeCard = FINANCE_RECORD_KINDS.has(kind) || row.domain === 'income';
  const primaryMoney = kind === 'debtRecord' ? moneyNumber(row.details?.remainingBalance || row.details?.originalAmount) : moneyNumber(row.details?.amount);
  const incomeAmountHtml = financeCard && primaryMoney > 0 ? `<strong class="income-card-amount">${incomeYen(primaryMoney)}${kind==='debtRecord'?'<small> 現在残高</small>':''}</strong>` : '';
  return `<article class="record ${wishClass} ${financeCard?'income-record':''} ${completed?'completed':''}">${completed?`<span class="completion-ribbon">✓ ${completionLabel}</span>`:''}<span class="record-date">${displayDate(row.date)}</span><div><span class="badge">${esc(financeCard?'お金':domainLabel(row.domain))}</span><h3>${esc(row.title)}</h3>${incomeAmountHtml}<p>${esc(row.body)}</p>${progress!==null?`<div class="progress" title="進捗 ${progress}%"><i style="width:${Math.max(0,Math.min(100,progress))}%"></i></div>`:''}<div class="record-meta">${row.details?.incomeType?`<span class="badge income-type-tag">${esc(row.details.incomeType)}</span>`:''}${row.details?.sourceName?`<span class="badge">収入元 ${esc(row.details.sourceName)}</span>`:''}${row.details?.incomePeriod?`<span class="badge">${esc(row.details.incomePeriod)}</span>`:''}${row.details?.incomeStatus?`<span class="badge ${row.details.incomeStatus==='見込'?'warn':row.details.incomeStatus==='確定'?'completion':''}">${esc(row.details.incomeStatus)}</span>`:''}${row.details?.amountKind?`<span class="badge">${esc(row.details.amountKind)}</span>`:''}${row.details?.expenseType?`<span class="badge expense-type-tag">${esc(row.details.expenseType)}</span>`:''}${row.details?.expensePeriod?`<span class="badge">${esc(row.details.expensePeriod)}</span>`:''}${row.details?.expenseStatus?`<span class="badge ${row.details.expenseStatus==='予定'?'warn':''}">${esc(row.details.expenseStatus)}</span>`:''}${row.details?.fixedCostType?`<span class="badge fixed-type-tag">${esc(row.details.fixedCostType)}</span>`:''}${row.details?.fixedCostFrequency?`<span class="badge">${esc(row.details.fixedCostFrequency)}</span>`:''}${row.details?.fixedCostStatus?`<span class="badge ${row.details.fixedCostStatus==='見直し候補'?'warn':''}">${esc(row.details.fixedCostStatus)}</span>`:''}${row.details?.debtType?`<span class="badge debt-type-tag">${esc(row.details.debtType)}</span>`:''}${row.details?.lenderName?`<span class="badge">借入先 ${esc(row.details.lenderName)}</span>`:''}${row.details?.monthlyPayment?`<span class="badge">毎月返済 ${incomeYen(moneyNumber(row.details.monthlyPayment))}</span>`:''}${row.details?.debtStatus?`<span class="badge ${row.details.debtStatus==='完済'?'completion':row.details.debtStatus==='返済猶予'?'warn':''}">${esc(row.details.debtStatus)}</span>`:''}${row.details?.wishType?`<span class="badge wish-type-tag ${wishClass}">${esc(row.details.wishType)}</span>`:''}${row.details?.wishArea?`<span class="badge wish-area-tag wish-area-${wishAreaClass(row.details.wishArea)}">${esc(row.details.wishArea)}</span>`:''}${row.details?.experienceType?`<span class="badge">${esc(row.details.experienceType)}</span>`:''}${kind==='healthItem'?`<span class="badge health-type-tag">${esc(healthItemType(row))}</span>`:''}${row.details?.medicalStatus?`<span class="badge ${row.details.medicalStatus==='完了'?'done':row.details.medicalStatus==='実施予定'?'warn':''}">${esc(row.details.medicalStatus)}</span>`:''}${row.details?.facilityWishId&&relatedMedicalPlaceName(row.details.facilityWishId)?`<span class="badge medical-facility">医療機関 ${esc(relatedMedicalPlaceName(row.details.facilityWishId))}</span>`:''}${impactBadge('身体',row.details?.physicalImpact)}${impactBadge('メンタル',row.details?.mentalImpact)}${impactBadge('収入',row.details?.incomeImpact)}${row.details?.wishStatus?`<span class="badge ${row.details.wishStatus==='実現済み'?'completion':''}">${esc(row.details.wishStatus)}</span>`:''}${row.details?.goalStatus?`<span class="badge ${row.details.goalStatus==='達成済み'?'completion':''}">${esc(row.details.goalStatus)}</span>`:''}${row.details?.priority?`<span class="badge ${row.details.priority==='高'?'warn':''}">優先度 ${esc(row.details.priority)}</span>`:''}${row.details?.frequency?`<span class="badge">${esc(row.details.frequency)}</span>`:''}${row.details?.budget?`<span class="badge">予算 ${esc(row.details.budget)}</span>`:''}</div>${referenceLinksHtml(row.details,true)}${attachments.map(file=>`<a class="attachment-link" href="${esc(file.url)}" target="_blank" rel="noopener noreferrer">添付：${esc(file.name)}</a>`).join('')}</div><div class="record-actions"><button class="btn small ghost" data-action="view-record" data-kind="${esc(kind)}" data-id="${esc(row.id)}">見る</button><button class="btn small ghost" data-action="edit-record" data-kind="${esc(kind)}" data-id="${esc(row.id)}">編集</button><button class="btn small danger" data-action="delete-record" data-kind="${esc(kind)}" data-id="${esc(row.id)}">削除</button></div></article>`;
}

function render() {
  updateChrome();
  const views = {home:renderHome,life:renderLife,health:renderHealth,work:renderWork,income:renderIncome,timeline:renderTimeline,reviews:renderReviews,ai:renderAI,integrations:renderIntegrations,data:renderData,profile:renderProfile,settings:renderSettings,search:renderSearch};
  $('#app').innerHTML = (views[page] || renderHome)();
  bindPage();
}

function bindPage() {
  document.querySelectorAll('[data-score]').forEach(element => element.addEventListener('input',()=>element.nextElementSibling.value=element.value));
  document.querySelectorAll('[data-setting]').forEach(element => element.addEventListener('change',async()=>{state.settings[element.dataset.setting]=element.value;await commit(state,'AI設定を変更しました')}));
  document.querySelectorAll('[data-theory]').forEach(element => element.addEventListener('change',async()=>{state.settings.theories[element.dataset.theory]=element.checked;await commit(state,'分析理論を更新しました')}));
  document.querySelectorAll('[data-integration-switch]').forEach(label => {
    const input = label.querySelector('input[type="checkbox"]');
    const text = label.querySelector('[data-switch-text]');
    if (!input || !text) return;
    input.addEventListener('change', async () => {
      const channel = label.dataset.integrationSwitch;
      const onText = channel === 'line' ? '準備ON' : '利用ON';
      const offText = channel === 'line' ? '準備OFF' : '利用OFF';
      text.textContent = input.checked ? onText : offText;
      await saveIntegrationSettings({ message:`${channel === 'line' ? 'LINE連携準備' : '相棒専用GPT'}を${input.checked ? 'ON' : 'OFF'}にしました`, rerender:true });
    });
  });
  $('#profileForm')?.addEventListener('submit',async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const now = isoNow();
    const fieldUpdatedAt = {...state.profile.fieldUpdatedAt};
    for (const [key,value] of Object.entries(data)) if (String(value) !== String(state.profile[key] ?? '')) fieldUpdatedAt[key] = now;
    state.profile = {...state.profile,...data,fieldUpdatedAt,updatedAt:now};
    await commit(state,'プロフィールを保存しました');
  });
  $('#globalSearch')?.addEventListener('input', updateSearchResults);
  document.querySelectorAll('[data-search-kind]').forEach(button => button.addEventListener('click',()=>{
    searchKind=button.dataset.searchKind;
    document.querySelectorAll('[data-search-kind]').forEach(item=>item.classList.toggle('active',item===button));
    updateSearchResults();
  }));
  document.querySelectorAll('[data-life-view]').forEach(button => button.addEventListener('click',()=>{
    lifeView=button.dataset.lifeView;
    render();
  }));
  document.querySelectorAll('[data-wish-tab]').forEach(button => button.addEventListener('click',()=>{
    wishTab=button.dataset.wishTab;
    document.querySelectorAll('[data-wish-tab]').forEach(item=>{
      const active=item===button;
      item.classList.toggle('active',active);
      item.setAttribute('aria-selected',String(active));
    });
    document.querySelectorAll('[data-wish-panel]').forEach(panel=>panel.classList.toggle('mobile-active',panel.dataset.wishPanel===wishTab));
  }));
  document.querySelectorAll('[data-finance-tab]').forEach(button => button.addEventListener('click',()=>{
    financeTab=button.dataset.financeTab;
    render();
  }));
  document.querySelectorAll('#costQuestions,#costInputTokens,#costOutputTokens,#costUsdJpy').forEach(input => input.addEventListener('input', updateCostPreview));
}

function detailFieldHtml(kind, details = {}) {
  return (DETAIL_FIELDS[kind] || []).map(([key,label,type,options]) => {
    const value = details[key] ?? '';
    if (type === 'textarea') return `<div class="field full" data-detail-field="${esc(key)}"><label>${label}</label><textarea name="detail__${key}">${esc(value)}</textarea></div>`;
    if (type === 'select') return `<div class="field" data-detail-field="${esc(key)}"><label>${label}</label><select name="detail__${key}">${String(options).split('|').map(option=>`<option value="${esc(option)}" ${String(value)===option?'selected':''}>${option===''?'選択してください':option==='weekly'?'週間':option==='monthly'?'月間':option==='yearly'?'年間':esc(option)}</option>`).join('')}</select></div>`;
    if (type === 'medicalPlace') {
      const places = medicalPlaceWishes();
      return `<div class="field" data-detail-field="${esc(key)}"><label>${label}</label><select name="detail__${key}"><option value="">選択しない</option>${places.map(place=>`<option value="${esc(place.id)}" ${String(value)===place.id?'selected':''}>${esc(place.title)}</option>`).join('')}</select><span class="hint">「人生設計 → 行きたい場所」で分野を「医療」にした病院・クリニックから選べます。</span></div>`;
    }
    const numberLimits = type === 'number' ? (['energy','progress'].includes(key) ? 'min="0" max="100"' : key === 'interestRate' ? 'min="0" step="0.01"' : 'min="0" step="1"') : '';
    return `<div class="field" data-detail-field="${esc(key)}"><label>${label}</label><input name="detail__${key}" type="${type}" value="${esc(value)}" ${numberLimits}></div>`;
  }).join('');
}

function openRecordDialog(kind, id = '', preset = {}) {
  const key = collectionFor(kind);
  if (!key) return toast('未対応の記録種類です','error');
  const existing = id ? state[key].find(row => row.id === id) : null;
  const seedDetails = existing?.details || preset.details || {};
  const dialog = $('#recordDialog');
  const titlePlaceholder = kind === 'wish' ? '例：キャンピングカー、北海道旅行、Kindle出版'
    : kind === 'incomeRecord' ? '例：給与、傷病手当、副業売上、年金'
    : kind === 'expenseRecord' ? '例：眼科の治療費、車検、家電購入、国民健康保険'
    : kind === 'fixedCostRecord' ? '例：家賃、スマホ代、保険料、サブスク'
    : kind === 'debtRecord' ? '例：○○銀行ローン、家族からの借入、事業借入'
    : kind === 'habit' ? '例：朝食を食べる、30分歩く、23時までに寝る'
    : kind === 'healthItem' ? '例：左目の状態、角膜手術の計画、大学病院への受診'
    : '例：朝の血圧、今月の目標、事業アイデア';
  const bodyPlaceholder = kind === 'wish' ? '欲しいもの・場所・挑戦・体験と、叶えたいイメージを自由に書いてください'
    : kind === 'incomeRecord' ? '入金条件・期間・変動理由など、必要な補足だけを書いてください'
    : kind === 'expenseRecord' ? '何のための支出か、今後も発生するかなど必要な補足を書いてください'
    : kind === 'fixedCostRecord' ? '契約内容、見直したい点、解約条件など必要な補足を書いてください'
    : kind === 'debtRecord' ? '借入の背景、返済上の注意点、契約メモなどを書いてください'
    : '事実や気づきを自由に書いてください';
  const urlLabel = kind === 'wish' ? '関連URL（商品・場所・体験のページ）'
    : FINANCE_RECORD_KINDS.has(kind) ? '関連URL（明細・契約・制度・サービスのページ）'
    : '関連URL（参考ページ・地図・予約ページなど）';
  const titleLabel = kind === 'incomeRecord' ? '収入名' : kind === 'expenseRecord' ? '支出名' : kind === 'fixedCostRecord' ? '固定費名' : kind === 'debtRecord' ? '負債・借入名' : 'タイトル';
  const bodyLabel = FINANCE_RECORD_KINDS.has(kind) ? '補足・メモ' : '概要・自由メモ';
  const selectedDomain = existing?.domain || preset.domain || defaultDomain(kind);
  const domainField = FINANCE_RECORD_KINDS.has(kind)
    ? '<div class="field"><label>分野</label><div class="locked-field">お金</div><input name="domain" type="hidden" value="income"></div>'
    : `<div class="field"><label>関連する分野</label><select name="domain">${DOMAINS.map(domain=>`<option value="${domain.id}" ${selectedDomain===domain.id?'selected':''}>${domain.label}</option>`).join('')}</select></div>`;
  const existingLinks = normalizeReferenceLinks(existing?.details || {});
  const editorLinks = existingLinks.length ? existingLinks : (preset.referenceLinks?.length ? preset.referenceLinks : [{}]);
  dialog.innerHTML = `<form id="recordForm"><div class="modal-head"><div><span class="badge">${existing?'編集':'新規'}</span><h2>${esc(KIND_LABELS[kind])}</h2></div><button class="icon-btn" type="button" data-close>×</button></div><div class="modal-body form-grid"><input type="hidden" name="kind" value="${kind}"><div class="field"><label>日付</label><input name="date" type="date" value="${esc(existing?.date || preset.date || localDateKey())}" required></div>${domainField}<div class="field full"><label>${titleLabel}</label><input name="title" value="${esc(existing?.title || preset.title || '')}" required placeholder="${titlePlaceholder}"></div><div class="field full"><label>${bodyLabel}</label><textarea name="body" placeholder="${bodyPlaceholder}">${esc(existing?.body || preset.body || '')}</textarea></div>${profileReferenceHtml(kind,{context:'editor'})}${detailFieldHtml(kind,seedDetails)}<div class="field full reference-links-field"><label>${urlLabel}（最大${MAX_REFERENCE_LINKS}件）</label><div id="referenceLinkRows" class="reference-link-editor">${editorLinks.map(referenceLinkEditorRow).join('')}</div><button class="btn small secondary add-reference" type="button" data-add-reference>＋ リンクを追加</button><span class="hint">公式サイト・SNS・YouTube・地図・予約／購入ページなど。名前は自由、https://は省略できます。</span></div><div class="field full"><label>タグ</label><input name="tags" value="${esc((existing?.tags||[]).join('、'))}" placeholder="${FINANCE_RECORD_KINDS.has(kind)?'医療、生活、事業、返済 など':kind==='habit'?'食事、ウォーキング、睡眠 など':'健康、挑戦、家族 など'}"></div><div class="field full duplicate-editor-slot" id="duplicateEditorSlot" hidden></div><div class="field full"><label>${FINANCE_RECORD_KINDS.has(kind)?'明細・契約書画像／添付':'画像・添付'}（任意・8MB以下）</label><input name="attachment" type="file"><span class="hint">添付はGoogle Driveへ保存します。同期設定が必要です。</span></div><p class="mobile-sheet-note field full">下へスクロールすると保存ボタンがあります。</p></div><div class="modal-actions"><button class="btn ghost" type="button" data-close>キャンセル</button><button class="btn" type="submit">${existing?'更新する':'保存する'}</button></div></form>`;
  dialog.showModal();
  dialog.querySelectorAll('[data-close]').forEach(button => button.onclick=()=>dialog.close());
  const linkRows = dialog.querySelector('#referenceLinkRows');
  const addLink = dialog.querySelector('[data-add-reference]');
  const updateLinkEditor = () => {
    const rows = [...linkRows.querySelectorAll('[data-reference-row]')];
    addLink.disabled = rows.length >= MAX_REFERENCE_LINKS;
    addLink.textContent = rows.length >= MAX_REFERENCE_LINKS ? `最大${MAX_REFERENCE_LINKS}件までです` : '＋ リンクを追加';
    rows.forEach(row => {
      row.querySelector('[data-remove-reference]').disabled = rows.length === 1;
    });
  };
  addLink.addEventListener('click', () => {
    if (linkRows.children.length >= MAX_REFERENCE_LINKS) return;
    linkRows.insertAdjacentHTML('beforeend', referenceLinkEditorRow());
    updateLinkEditor();
    linkRows.lastElementChild?.querySelector('[data-reference-label]')?.focus();
  });
  linkRows.addEventListener('click', event => {
    const remove = event.target.closest('[data-remove-reference]');
    if (!remove || linkRows.children.length <= 1) return;
    remove.closest('[data-reference-row]').remove();
    updateLinkEditor();
  });
  updateLinkEditor();
  const duplicateSlot = dialog.querySelector('#duplicateEditorSlot');
  const refreshDuplicateWarning = () => {
    const candidate = duplicateCandidateFromForm($('#recordForm'), kind, existing?.details || {});
    const matches = duplicateCheckEnabled(kind) && candidate.title.length >= 2 ? findDuplicateCandidates(state[key], candidate, kind, existing?.id || '') : [];
    duplicateSlot.innerHTML = duplicateEditorWarningHtml(matches);
    duplicateSlot.hidden = !matches.length;
    return matches;
  };
  ['title','body','tags','detail__wishType'].forEach(name => {
    dialog.querySelector(`[name="${name}"]`)?.addEventListener('input', refreshDuplicateWarning);
    dialog.querySelector(`[name="${name}"]`)?.addEventListener('change', refreshDuplicateWarning);
  });
  refreshDuplicateWarning();
  if (kind === 'wish') {
    const typeSelect = dialog.querySelector('[name="detail__wishType"]');
    const subtypeSelect = dialog.querySelector('[name="detail__experienceType"]');
    const areaSelect = dialog.querySelector('[name="detail__wishArea"]');
    const domainSelect = dialog.querySelector('[name="domain"]');
    const updateSubtypeVisibility = () => {
      const applies = typeSelect.value === 'やってみたいこと・挑戦・体験';
      subtypeSelect.closest('.field').hidden = !applies;
      if (!applies) subtypeSelect.value = '';
    };
    const updateWishDomain = () => {
      if (!existing && domainSelect && ['健康・身体','医療','メンタル'].includes(areaSelect?.value)) domainSelect.value = 'health';
    };
    typeSelect.addEventListener('change', updateSubtypeVisibility);
    areaSelect?.addEventListener('change', updateWishDomain);
    updateSubtypeVisibility();
    updateWishDomain();
  }
  if (kind === 'healthItem') {
    const typeSelect = dialog.querySelector('[name="detail__healthItemType"]');
    const medicalKeys = ['medicalStatus','facilityWishId','department','targetDate','estimatedCost','hospitalDays','recoveryTime','physicalImpact','mentalImpact','incomeImpact'];
    const updateMedicalVisibility = () => {
      const applies = MEDICAL_PLAN_TYPES.has(typeSelect?.value || '');
      medicalKeys.forEach(key => {
        const field = dialog.querySelector(`[data-detail-field="${key}"]`);
        if (!field) return;
        field.hidden = !applies;
        if (!applies && !existing) field.querySelector('input,select,textarea')?.setAttribute('data-clear-on-save','true');
      });
    };
    typeSelect?.addEventListener('change', updateMedicalVisibility);
    updateMedicalVisibility();
  }
  $('#recordForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.submitter;
    if (submit) { submit.disabled=true; submit.textContent='保存中…'; }
    const form = event.currentTarget;
    const raw = Object.fromEntries(new FormData(form));
    const details = {...(existing?.details || {})};
    for (const [name,value] of Object.entries(raw)) if (name.startsWith('detail__')) details[name.slice(8)] = value;
    const rawLinks = [...form.querySelectorAll('[data-reference-row]')].map((row,index) => ({
      label: row.querySelector('[data-reference-label]').value.trim() || `関連リンク${index + 1}`,
      rawUrl: row.querySelector('[data-reference-url]').value.trim()
    })).filter(link => link.rawUrl);
    const invalidLink = rawLinks.find(link => !normalizeExternalUrl(link.rawUrl));
    if (invalidLink) {
      if (submit) { submit.disabled=false; submit.textContent=existing?'更新する':'保存する'; }
      return toast(`「${invalidLink.label}」のURLを確認してください。http:// または https:// のWebページだけ保存できます。`,'error');
    }
    const referenceLinks = normalizeReferenceLinks({ referenceLinks: rawLinks.map(link => ({ label:link.label, url:link.rawUrl })) });
    if (referenceLinks.length) {
      details.referenceLinks = referenceLinks;
      details.referenceUrl = referenceLinks[0].url;
    } else {
      delete details.referenceLinks;
      delete details.referenceUrl;
    }
    if (kind === 'goal') {
      const progress = Number(details.progress || 0);
      if (details.goalStatus === '達成済み' || progress >= 100) {
        details.goalStatus = '達成済み';
        details.progress = '100';
      }
    }
    if (kind === 'wish' && details.wishType !== 'やってみたいこと・挑戦・体験') delete details.experienceType;
    if (kind === 'wish' && !details.wishArea) details.wishArea = '一般';
    if (kind === 'healthItem' && !details.healthItemType) details.healthItemType = '症状・健康管理';
    if (kind === 'healthItem' && !MEDICAL_PLAN_TYPES.has(details.healthItemType)) {
      for (const key of ['medicalStatus','facilityWishId','department','targetDate','estimatedCost','hospitalDays','recoveryTime','physicalImpact','mentalImpact','incomeImpact']) delete details[key];
    }
    const duplicateCandidate = { title:raw.title, body:raw.body, tags:raw.tags, details };
    const duplicateMatches = duplicateCheckEnabled(kind) ? findDuplicateCandidates(state[key], duplicateCandidate, kind, existing?.id || '') : [];
    if (duplicateMatches.length && !window.confirm(`似た登録が${duplicateMatches.length}件あります。\n\n${duplicateMatches.slice(0,3).map(match=>`・${match.row.title}（${match.reasons.join('・')}）`).join('\n')}\n\n別の内容として、このまま保存しますか？`)) {
      if (submit) { submit.disabled=false; submit.textContent=existing?'更新する':'保存する'; }
      refreshDuplicateWarning();
      return;
    }
    const completedStatus = kind === 'goal' && details.goalStatus === '達成済み';
    const base = {...(existing || {}),date:raw.date,domain:raw.domain,title:raw.title,body:raw.body,tags:raw.tags,details,status:completedStatus?'done':((existing?.status==='done'&&kind==='goal')?'active':existing?.status),updatedAt:isoNow()};
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
    await commit(state,`${KIND_LABELS[kind]}を${existing?'更新':'保存'}しました`);
    dialog.close();
    render();
  });
}

function detailDisplayValue(key, value) {
  if (key === 'facilityWishId') return relatedMedicalPlaceName(value) || value;
  if (['amount','originalAmount','remainingBalance','monthlyPayment'].includes(key) && String(value).trim() !== '') return incomeYen(moneyNumber(value));
  if (key === 'interestRate' && String(value).trim() !== '') return `${value}%`;
  return value;
}


function defaultDomain(kind) {
  if (kind === 'healthItem') return 'health';
  if (FINANCE_RECORD_KINDS.has(kind)) return 'income';
  if (kind === 'product') return 'work';
  if (kind === 'goal') return 'challenge';
  if (kind === 'wish') return 'freedom';
  return 'happiness';
}

function showRecord(kind,id) {
  const row = state[collectionFor(kind)]?.find(item=>item.id===id);
  if (!row) return;
  const links = normalizeReferenceLinks(row.details || {});
  const detailRows = Object.entries(row.details || {}).filter(([key,value]) => value && !['attachments','referenceUrl','referenceLinks'].includes(key)).map(([key,value])=>`<div class="detail-row"><small>${esc(DETAIL_LABELS[key]||key)}</small><p>${esc(detailDisplayValue(key,value))}</p></div>`).join('');
  const attachments = (row.details?.attachments || []).map(file=>`<a class="attachment-link" href="${esc(file.url)}" target="_blank" rel="noopener noreferrer">${esc(file.name)}</a>`).join('');
  const dialog = $('#detailDialog');
  const linkDetails = links.length ? `<div class="detail-row"><small>関連URL（${links.length}件）</small><div class="reference-links detail-links">${links.map(link => `<div><a class="reference-link" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">↗ ${esc(link.label)}</a><p class="url-text">${esc(link.url)}</p></div>`).join('')}</div></div>` : '';
  dialog.innerHTML = `<div class="modal-head"><div><span class="badge">${esc(KIND_LABELS[kind]||kind)}</span><h2>${esc(row.title)}</h2></div><button class="icon-btn" data-close>×</button></div><div class="modal-body"><div class="detail-grid"><div class="detail-row"><small>日付・分野</small><p>${displayDate(row.date)} ／ ${esc(domainLabel(row.domain))}</p></div>${row.body?`<div class="detail-row"><small>概要・メモ</small><p>${esc(row.body)}</p></div>`:''}${profileReferenceHtml(kind,{context:'detail'})}${linkDetails}${detailRows}${attachments?`<div class="detail-row"><small>添付</small>${attachments}</div>`:''}</div></div><div class="modal-actions"><button class="btn ghost" data-close>閉じる</button><button class="btn" data-action="edit-from-detail" data-kind="${esc(kind)}" data-id="${esc(id)}">編集する</button></div>`;
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

async function saveIntegrationSettings({ message = 'AI連携設定を保存しました', rerender = true } = {}) {
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
    connected: isCustomGptUrl(gptUrl),
    useActions: Boolean($('#gptUseActions')?.checked),
    gptUrl,
    scopes: currentScopes('gpt')
  };
  integrations.cost = currentCostConfig();
  await commit(state, message, { autoSync: true, rerender });
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
    if (action === 'new-record') {
      const details = {};
      if (element.dataset.healthType) details.healthItemType = element.dataset.healthType;
      if (element.dataset.wishType) details.wishType = element.dataset.wishType;
      if (element.dataset.wishArea) details.wishArea = element.dataset.wishArea;
      const presetDomain = element.dataset.wishArea && ['健康・身体','医療','メンタル'].includes(element.dataset.wishArea) ? 'health' : '';
      return openRecordDialog(element.dataset.kind, '', { details, ...(presetDomain ? { domain:presetDomain } : {}) });
    }
    if (action === 'edit-profile-context') return goToProfileField(element.dataset.profileFocus || '');
    if (action === 'edit-record') return openRecordDialog(element.dataset.kind,element.dataset.id);
    if (action === 'view-record') return showRecord(element.dataset.kind,element.dataset.id);
    if (action === 'save-scores') {
      const now=isoNow();
      document.querySelectorAll('[data-score]').forEach(input=>{if(Number(state.scores[input.dataset.score])!==Number(input.value)){state.scores[input.dataset.score]=Number(input.value);state.scoreUpdatedAt[input.dataset.score]=now}});
      await commit(state,'人生レーダーを保存しました',{rerender:true}); return;
    }
    if (action === 'done') {
      const row = state[collectionFor(element.dataset.kind)]?.find(item=>item.id===element.dataset.id);
      if (row) { row.status='done'; row.updatedAt=isoNow(); await commit(state,'完了にしました',{rerender:true}); } return;
    }
    if (action === 'delete-record') {
      const row = state[collectionFor(element.dataset.kind)]?.find(item=>item.id===element.dataset.id);
      if (row && confirm('この記録を削除しますか？ 後から「連携・移行」で復元できます。')) { row.deletedAt=isoNow();row.updatedAt=isoNow();await commit(state,'記録を削除しました',{rerender:true}); } return;
    }
    if (action === 'restore-record') {
      const row = state[collectionFor(element.dataset.kind)]?.find(item=>item.id===element.dataset.id);
      if (row) { row.deletedAt=null;row.updatedAt=isoNow();await commit(state,'記録を復元しました',{rerender:true}); } return;
    }
    if (action === 'ask-ai') return runAI(element.dataset.mode);
    if (action === 'quick-ai') return setPage('ai');
    if (action === 'run-simulation') return runSimulation();
    if (action === 'generate-review') return generateReview(element.dataset.period,element);
    if (action === 'sync') return performSync();
    if (action === 'refresh-notebooklm') return refreshNotebookLM(element);
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
      const entered = $('#gptUrl')?.value.trim() || state.settings.integrations.gpt.gptUrl || '';
      const url = isCustomGptUrl(entered) ? entered : 'https://chatgpt.com/gpts';
      window.open(url, '_blank', 'noopener,noreferrer'); return;
    }
    if (action === 'export-json') { downloadBlob(exportBackup(state),`LifeCompassAIOS_backup_${dateStamp()}.json`);toast('JSONバックアップを書き出しました');return; }
    if (action === 'import-json') return $('#jsonFile').click();
    if (action.startsWith('export-')) return exportFor(action);
    if (action === 'save-settings') { state.settings.gasUrl=$('#gasUrl').value.trim();state.settings.syncToken=$('#syncToken').value.trim();state.settings.syncEnabled=Boolean(state.settings.gasUrl&&state.settings.syncToken);state.settings.autoSync=$('#autoSync').checked;await commit(state,'接続設定を保存しました',{autoSync:false,rerender:true});return; }
    if (action === 'save-display') { state.settings.fontScale=Number($('#fontScale').value);await commit(state,'表示設定を保存しました',{rerender:true});return; }
    if (action === 'install-app') return installApp();
    if (action === 'reset-local' && confirm('この端末のキャッシュを初期化します。クラウド正本は削除されません。先にJSONバックアップを保存しましたか？')) { await clearLocalCache();state=createEmptyState();state=await saveCache(state,{touch:false});toast('この端末のキャッシュを初期化しました');render(); }
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
    await commit(state,'AI分析を保存しました');
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
    await commit(state,'シミュレーション結果を保存しました');result.classList.remove('loading');result.textContent=item.answer;
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
    await commit(state,`${labels[period]}レビューを保存しました`);render();
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
  dialog.querySelector('[data-action="apply-migration"]').onclick=async()=>{state=migrationInspection.batch?applyMigrationBatch(state,migrationInspection,{profile:$('#migrationProfile').value,conflict:$('#migrationConflict').value}):applyMigration(state,migrationInspection,{profile:$('#migrationProfile').value,conflict:$('#migrationConflict').value});await commit(state,'旧JSONを新OSへ統合しました');dialog.close();render()};
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
$('#menuButton').onclick=()=>setSidebarOpen(!$('#sidebar').classList.contains('open'));
$('#sidebarBackdrop').onclick=()=>setSidebarOpen(false);
document.addEventListener('keydown',event=>{if(event.key==='Escape')setSidebarOpen(false)});
window.addEventListener('resize',()=>{if(!window.matchMedia('(max-width:980px)').matches)setSidebarOpen(false)});
$('#jsonFile').addEventListener('change',event=>{if(event.target.files.length)inspectFiles(event.target.files);event.target.value=''});
window.addEventListener('hashchange',()=>{
  const requested=location.hash.slice(1);
  page=validPage(requested);
  if(requested!==page)history.replaceState(null,'',`${location.pathname}${location.search}#${page}`);
  render();
});
window.addEventListener('online',()=>{updateChrome();scheduleAutoSync()});
window.addEventListener('offline',()=>updateChrome());
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;$('#installButton').hidden=false});
$('#todayLabel').textContent=new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short',timeZone:'Asia/Tokyo'}).format(new Date());
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  try {
    const registration = await navigator.serviceWorker.register('./sw.js?v=3.1.0', { updateViaCache:'none' });
    await registration.update();
    if (hadController) {
      navigator.serviceWorker.addEventListener('controllerchange',()=>{
        const refreshKey='life-compass-sw-refresh-v3.1.0';
        if(sessionStorage.getItem(refreshKey))return;
        sessionStorage.setItem(refreshKey,'1');
        location.reload();
      });
    }
  } catch (_) {
    // オフラインや非対応環境でも、端末保存版として通常利用を続ける。
  }
}
async function bootstrap() {
  try { state = await loadCache(); }
  catch (error) { toast(error.message || '端末データを読み込めませんでした','error'); }
  render();
  scheduleAutoSync();
  registerServiceWorker();
}
bootstrap();
