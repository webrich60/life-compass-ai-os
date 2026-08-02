/** Life Compass AI OS v2.1.0 backend (Google Apps Script) */
const LC = {
  STATE_SHEET: 'LifeCompass_State', RECORD_SHEET: 'LifeCompass_Records',
  AI_SHEET: 'LifeCompass_AI_History', SYNC_SHEET: 'LifeCompass_Sync_Log',
  STATE_KEY: 'main', CHUNK_SIZE: 40000, MAX_AI_HISTORY: 100
};

function doGet(e) {
  try {
    return jsonOut_({ ok: true, service: 'Life Compass AI OS', version: '2.1.0', time: new Date().toISOString() });
  } catch (err) { return jsonOut_({ ok: false, error: safeError_(err) }); }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    verifyToken_(body.token);
    if (body.action === 'load') return jsonOut_({ ok: true, state: loadState_() });
    if (body.action === 'sync') return jsonOut_(syncState_(body.state || {}));
    if (body.action === 'ai') return jsonOut_(runAi_(body));
    if (body.action === 'upload') return jsonOut_(uploadFile_(body));
    if (body.action === 'get_scoped_context') return jsonOut_({ ok:true, context:buildScopedContext_(loadState_(), body.scopes || {}) });
    throw new Error('未対応の操作です');
  } catch (err) { logSync_('error', safeError_(err)); return jsonOut_({ ok: false, error: safeError_(err) }); }
}

function setupLifeCompassAIOS() {
  const ss = getSpreadsheet_();
  ensureSheet_(ss, LC.STATE_SHEET, ['key','chunkIndex','chunkCount','jsonChunk','revision','updatedAt']);
  ensureSheet_(ss, LC.RECORD_SHEET, ['id','kind','domain','title','body','status','date','value','tags','deletedAt','createdAt','updatedAt','source']);
  ensureSheet_(ss, LC.AI_SHEET, ['id','createdAt','provider','mode','persona','question','answer','theories']);
  ensureSheet_(ss, LC.SYNC_SHEET, ['createdAt','status','message','revision']);
  const props = PropertiesService.getScriptProperties();
  props.setProperty('LIFE_COMPASS_SETUP_AT', new Date().toISOString());
  if (!props.getProperty('SYNC_TOKEN')) props.setProperty('SYNC_TOKEN', createToken_());
  return '準備完了。generateLifeCompassSyncToken() を実行して同期トークンを確認し、ウェブアプリを再デプロイしてください。';
}

function generateLifeCompassSyncToken() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('SYNC_TOKEN');
  if (!token) { token = createToken_(); props.setProperty('SYNC_TOKEN', token); }
  console.log('SYNC_TOKEN: ' + token);
  return token;
}

function rotateLifeCompassSyncToken() {
  const token = createToken_();
  PropertiesService.getScriptProperties().setProperty('SYNC_TOKEN', token);
  console.log('NEW_SYNC_TOKEN: ' + token);
  return token;
}

function syncState_(incoming) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const cloud = loadState_();
    const merged = mergeState_(cloud, incoming);
    merged.meta = merged.meta || {};
    merged.meta.revision = Math.max(Number(cloud.meta && cloud.meta.revision || 0), Number(incoming.meta && incoming.meta.revision || 0)) + 1;
    merged.meta.updatedAt = new Date().toISOString();
    merged.meta.lastSyncedAt = merged.meta.updatedAt;
    saveState_(merged); writeRecordIndex_(merged); logSync_('ok', '同期完了', merged.meta.revision);
    return { ok: true, state: merged };
  } finally { lock.releaseLock(); }
}

function mergeState_(cloud, incoming) {
  if (!incoming || !incoming.meta) return cloud;
  cloud = cloud && typeof cloud === 'object' ? cloud : {};
  const out = JSON.parse(JSON.stringify(cloud));
  const lists = ['records','goals','habits','wishes','healthItems','timeline','comparisons','products','reviews','simulations'];
  lists.forEach(function(key) {
    const map = {};
    (cloud[key] || []).concat(incoming[key] || []).forEach(function(row) {
      if (!row || !row.id) return;
      const old = map[row.id];
      if (!old || new Date(row.updatedAt || row.createdAt || 0) >= new Date(old.updatedAt || old.createdAt || 0)) map[row.id] = row;
    });
    out[key] = Object.keys(map).map(function(id){ return map[id]; });
  });
  out.profile = mergeProfile_(cloud.profile, incoming.profile);
  const scoreMerge = mergeScores_(cloud, incoming);
  out.scores = scoreMerge.scores;
  out.scoreUpdatedAt = scoreMerge.scoreUpdatedAt;
  out.scoreNotes = Object.assign({}, cloud.scoreNotes || {}, incoming.scoreNotes || {});
  out.settings = Object.assign({}, cloud.settings || {}, incoming.settings || {});
  out.settings.integrations = mergeIntegrations_((cloud.settings||{}).integrations, (incoming.settings||{}).integrations);
  delete out.settings.gasUrl;
  delete out.settings.syncToken;
  const history = (cloud.aiHistory || []).concat(incoming.aiHistory || []);
  const seen = {};
  out.aiHistory = history.filter(function(x){ const k=x.id || [x.createdAt,x.question].join('|'); if(seen[k])return false;seen[k]=true;return true; }).slice(-LC.MAX_AI_HISTORY);
  out.schemaVersion = 4;
  return out;
}

function mergeIntegrations_(cloud,incoming) {
  const c=cloud||{},i=incoming||{};
  const out=Object.assign({},c,i);
  out.line=Object.assign({},c.line||{},i.line||{});
  out.line.scopes=Object.assign({},(c.line||{}).scopes||{},(i.line||{}).scopes||{});
  out.gpt=Object.assign({},c.gpt||{},i.gpt||{});
  out.gpt.scopes=Object.assign({},(c.gpt||{}).scopes||{},(i.gpt||{}).scopes||{});
  out.cost=Object.assign({},c.cost||{},i.cost||{});
  return out;
}

function buildScopedContext_(state,scopes) {
  state=state||{};scopes=scopes||{};
  const active=function(rows){return (rows||[]).filter(function(row){return !row.deletedAt;});};
  const last=function(rows,count){return active(rows).slice(-count);};
  const allowed=function(row){
    const domain=String(row&&row.domain||'');
    return (domain!=='health'||scopes.health)&&(domain!=='family'||scopes.family)&&(domain!=='income'||scopes.finance);
  };
  const allowedLast=function(rows,count){return active(rows).filter(allowed).slice(-count);};
  const profile=state.profile||{},safeProfile={};
  const copy=function(keys){keys.forEach(function(key){if(profile[key])safeProfile[key]=profile[key];});};
  if(scopes.basicProfile)copy(['name','age','personality','satisfaction']);
  if(scopes.values)copy(['likes','strengths','values']);
  if(scopes.work)copy(['workHistory']);
  if(scopes.health)copy(['medicalHistory','constraints','supportNeeds','trauma']);
  if(scopes.family)copy(['family']);
  if(scopes.location)copy(['location']);
  const out={generatedAt:new Date().toISOString(),profile:safeProfile};
  if(scopes.scores){
    out.scores={};
    Object.keys(state.scores||{}).forEach(function(key){if(allowed({domain:key}))out.scores[key]=state.scores[key];});
    const values=Object.keys(out.scores).map(function(key){return Number(out.scores[key]);}).filter(function(value){return isFinite(value);});
    out.lifeScore=values.length?Math.round(values.reduce(function(sum,value){return sum+value;},0)/values.length):null;
  }
  if(scopes.goals)out.goals=allowedLast(state.goals,30);
  if(scopes.habits)out.habits=allowedLast(state.habits,30);
  if(scopes.wishes)out.wishes=allowedLast(state.wishes,40);
  if(scopes.timeline)out.timeline=allowedLast(state.timeline,60);
  if(scopes.products)out.products=allowedLast(state.products,30);
  if(scopes.reviews)out.reviews=allowedLast(state.reviews,20);
  if(scopes.health)out.health=last(state.healthItems,30);
  if(scopes.recentRecords)out.recentRecords=allowedLast(state.records,30);
  if(scopes.aiHistory)out.aiHistory=(state.aiHistory||[]).slice(-30);
  return out;
}

function newerObject_(a,b) {
  a=a||{};b=b||{};
  return new Date(b.updatedAt || 0) > new Date(a.updatedAt || 0) ? b : a;
}

function mergeProfile_(cloudProfile, incomingProfile) {
  const c=cloudProfile||{}, i=incomingProfile||{};
  const out=Object.assign({},c,{fieldUpdatedAt:Object.assign({},c.fieldUpdatedAt||{})});
  const ignored={id:true,updatedAt:true,fieldUpdatedAt:true};
  const keys={}; Object.keys(c).concat(Object.keys(i)).forEach(function(k){keys[k]=true;});
  Object.keys(keys).forEach(function(key){
    if(ignored[key])return;
    const iv=i[key], cv=c[key];
    const it=new Date((i.fieldUpdatedAt||{})[key]||i.updatedAt||0);
    const ct=new Date((c.fieldUpdatedAt||{})[key]||c.updatedAt||0);
    if(iv!==''&&iv!=null&&(cv===''||cv==null||it>=ct)){
      out[key]=iv; out.fieldUpdatedAt[key]=(i.fieldUpdatedAt||{})[key]||i.updatedAt;
    }
  });
  out.id=i.id||c.id||'profile_main';
  out.updatedAt=new Date(i.updatedAt||0)>=new Date(c.updatedAt||0)?i.updatedAt:c.updatedAt;
  return out;
}

function mergeScores_(cloud,incoming){
  const scores=Object.assign({},cloud.scores||{}),times=Object.assign({},cloud.scoreUpdatedAt||{});
  const cloudLegacy=!Object.prototype.hasOwnProperty.call(cloud,'scoreUpdatedAt');
  const incomingLegacy=!Object.prototype.hasOwnProperty.call(incoming,'scoreUpdatedAt');
  const keys={};Object.keys(cloud.scores||{}).concat(Object.keys(incoming.scores||{})).forEach(function(k){keys[k]=true;});
  Object.keys(keys).forEach(function(key){
    const it=new Date((incoming.scoreUpdatedAt||{})[key]||(incomingLegacy&&(incoming.meta||{}).updatedAt)||0);
    const ct=new Date((cloud.scoreUpdatedAt||{})[key]||(cloudLegacy&&(cloud.meta||{}).updatedAt)||0);
    if(it>=ct){scores[key]=(incoming.scores||{})[key];times[key]=(incoming.scoreUpdatedAt||{})[key]||(incomingLegacy&&(incoming.meta||{}).updatedAt)||times[key]||'';}
  });
  return {scores:scores,scoreUpdatedAt:times};
}

function loadState_() {
  const sheet = getSpreadsheet_().getSheetByName(LC.STATE_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return {};
  const values = sheet.getRange(2,1,sheet.getLastRow()-1,6).getValues()
    .filter(function(r){ return r[0] === LC.STATE_KEY; }).sort(function(a,b){ return Number(a[1])-Number(b[1]); });
  if (!values.length) return {};
  try { return JSON.parse(values.map(function(r){ return r[3]; }).join('')); }
  catch (err) { throw new Error('クラウド正本のJSONが破損しています。JSONバックアップから復元してください。'); }
}

function saveState_(state) {
  const sheet = getSpreadsheet_().getSheetByName(LC.STATE_SHEET);
  const json = JSON.stringify(state), chunks=[];
  for (let i=0;i<json.length;i+=LC.CHUNK_SIZE) chunks.push(json.slice(i,i+LC.CHUNK_SIZE));
  if (sheet.getLastRow() > 1) sheet.getRange(2,1,sheet.getLastRow()-1,6).clearContent();
  const now = new Date();
  sheet.getRange(2,1,chunks.length,6).setValues(chunks.map(function(chunk,i){return [LC.STATE_KEY,i,chunks.length,chunk,state.meta.revision||0,now];}));
}

function writeRecordIndex_(state) {
  const sheet = getSpreadsheet_().getSheetByName(LC.RECORD_SHEET);
  const keys = ['records','goals','habits','wishes','healthItems','timeline','comparisons','products','reviews','simulations'];
  let rows=[]; keys.forEach(function(k){ (state[k]||[]).forEach(function(r){rows.push([r.id,r.kind||k,r.domain,r.title,r.body,r.status,r.date,r.value,(r.tags||[]).join(', '),r.deletedAt||'',r.createdAt,r.updatedAt,r.source]);}); });
  if(sheet.getLastRow()>1) sheet.getRange(2,1,sheet.getLastRow()-1,13).clearContent();
  if(rows.length) sheet.getRange(2,1,rows.length,13).setValues(rows);
}

function runAi_(req) {
  const prompt = buildPrompt_(req);
  const provider = String(req.provider || 'gemini');
  const answer = provider === 'openai' ? callOpenAI_(prompt) : callGemini_(prompt);
  const item = { id: Utilities.getUuid(), createdAt: new Date().toISOString(), provider: provider, mode: req.mode || 'cross', persona: req.persona || 'コーチ', question: req.question || '', answer: answer, theories: req.theories || [] };
  const sheet = getSpreadsheet_().getSheetByName(LC.AI_SHEET);
  sheet.appendRow([item.id,item.createdAt,item.provider,item.mode,item.persona,item.question,item.answer,item.theories.join(', ')]);
  trimSheet_(sheet, LC.MAX_AI_HISTORY + 1);
  return { ok:true, answer:answer, item:item };
}

function buildPrompt_(req) {
  const rules = [
    'あなたはLife Compass AI OSの伴走AIです。人格は「'+String(req.persona||'コーチ')+'」です。',
    '利用する観点: '+(req.theories||[]).join('、'),
    '必ず「事実」「推測」「改善案」「優先順位」「今日の一歩」を明確に分けて日本語で回答してください。',
    '事実にない情報を断定しないでください。推測には推測と明記してください。',
    '医療診断・投薬指示はしません。危険な症状が疑われる場合は適切な医療機関への相談を促してください。',
    '未来は予言せず、条件付きシミュレーションとして示してください。',
    '回答は具体的で実行可能にし、最優先事項を多くても3つに絞ってください。'
  ].join('\n');
  return rules+'\n\n【相談】\n'+String(req.question||'')+'\n\n【本人が登録したデータ】\n'+JSON.stringify(req.context||{});
}

function callGemini_(prompt) {
  const props=PropertiesService.getScriptProperties(), key=props.getProperty('GEMINI_API_KEY');
  if(!key) throw new Error('GEMINI_API_KEYが未設定です');
  const model=props.getProperty('GEMINI_MODEL')||'gemini-2.5-flash';
  const url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent?key='+encodeURIComponent(key);
  const res=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',payload:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:.45,maxOutputTokens:3500}}),muteHttpExceptions:true});
  const json=JSON.parse(res.getContentText()||'{}');
  if(res.getResponseCode()>=300) throw new Error('Gemini API: '+(json.error&&json.error.message||res.getResponseCode()));
  return (((json.candidates||[])[0]||{}).content||{}).parts.map(function(p){return p.text||'';}).join('') || '回答を生成できませんでした。';
}

function callOpenAI_(prompt) {
  const props=PropertiesService.getScriptProperties(), key=props.getProperty('OPENAI_API_KEY');
  if(!key) throw new Error('OPENAI_API_KEYが未設定です');
  const model=props.getProperty('OPENAI_MODEL')||'gpt-5.4-mini';
  const res=UrlFetchApp.fetch('https://api.openai.com/v1/responses',{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+key},payload:JSON.stringify({model:model,input:prompt,max_output_tokens:3500}),muteHttpExceptions:true});
  const json=JSON.parse(res.getContentText()||'{}');
  if(res.getResponseCode()>=300) throw new Error('OpenAI API: '+(json.error&&json.error.message||res.getResponseCode()));
  if(json.output_text) return json.output_text;
  return (json.output||[]).flatMap(function(x){return x.content||[];}).map(function(x){return x.text||'';}).join('') || '回答を生成できませんでした。';
}

function uploadFile_(req) {
  const props=PropertiesService.getScriptProperties(),folderId=props.getProperty('DRIVE_FOLDER_ID');
  if(!folderId) throw new Error('DRIVE_FOLDER_IDが未設定です');
  const bytes=Utilities.base64Decode(String(req.base64||'').replace(/^data:[^;]+;base64,/,''));
  if(bytes.length>8*1024*1024) throw new Error('添付は8MB以下にしてください');
  const blob=Utilities.newBlob(bytes,String(req.mimeType||'application/octet-stream'),String(req.fileName||'attachment'));
  const file=DriveApp.getFolderById(folderId).createFile(blob);
  return {ok:true,fileId:file.getId(),name:file.getName(),url:file.getUrl()};
}

function verifyToken_(provided) {
  const expected = PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN');
  if (!expected) throw new Error('SYNC_TOKENが未設定です。setupLifeCompassAIOS()を実行してください。');
  if (!provided || String(provided) !== String(expected)) throw new Error('同期トークンが一致しません');
}
function createToken_(){return Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');}

function getSpreadsheet_() {
  const id=PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if(!id) throw new Error('SPREADSHEET_IDが未設定です');
  return SpreadsheetApp.openById(id);
}
function ensureSheet_(ss,name,headers){let s=ss.getSheetByName(name);if(!s)s=ss.insertSheet(name);if(s.getLastRow()===0)s.appendRow(headers);s.setFrozenRows(1);return s;}
function trimSheet_(sheet,maxRows){const last=sheet.getLastRow();if(last>maxRows)sheet.deleteRows(2,last-maxRows);}
function logSync_(status,message,revision){try{getSpreadsheet_().getSheetByName(LC.SYNC_SHEET).appendRow([new Date(),status,message,revision||'']);}catch(_){}}
function safeError_(err){return String(err&&err.message||err).slice(0,500);}
function jsonOut_(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);}
