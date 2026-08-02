import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8');
const context = vm.createContext({ console });
vm.runInContext(source, context);

function merge(cloud, incoming) {
  context.__cloud = structuredClone(cloud);
  context.__incoming = structuredClone(incoming);
  return vm.runInContext('mergeState_(__cloud, __incoming)', context);
}

test('first cloud sync never stores the browser GAS URL or sync token', () => {
  const incoming = {
    schemaVersion: 3,
    meta: { revision: 1, updatedAt: '2026-08-01T01:00:00Z' },
    profile: { id: 'profile_main', name: '相棒', updatedAt: '2026-08-01T01:00:00Z', fieldUpdatedAt: { name: '2026-08-01T01:00:00Z' } },
    scores: { health: 70 }, scoreUpdatedAt: { health: '2026-08-01T01:00:00Z' },
    settings: { provider: 'gemini', gasUrl: 'https://secret.example', syncToken: 'secret-token' },
    records: [], goals: [], habits: [], wishes: [], healthItems: [], timeline: [], comparisons: [], products: [], reviews: [], simulations: [], aiHistory: []
  };
  const result = merge({}, incoming);
  assert.equal(result.profile.name, '相棒');
  assert.equal(result.settings.gasUrl, undefined);
  assert.equal(result.settings.syncToken, undefined);
});

test('GAS profile merge preserves fields changed on separate devices', () => {
  const base = {
    schemaVersion: 3, scores: {}, scoreUpdatedAt: {}, settings: {},
    records: [], goals: [], habits: [], wishes: [], healthItems: [], timeline: [], comparisons: [], products: [], reviews: [], simulations: [], aiHistory: []
  };
  const cloud = { ...base, meta:{updatedAt:'2026-08-01T01:00:00Z'}, profile:{name:'相棒',medicalHistory:'',updatedAt:'2026-08-01T01:00:00Z',fieldUpdatedAt:{name:'2026-08-01T01:00:00Z'}} };
  const incoming = { ...base, meta:{updatedAt:'2026-08-01T02:00:00Z'}, profile:{name:'',medicalHistory:'既往歴',updatedAt:'2026-08-01T02:00:00Z',fieldUpdatedAt:{medicalHistory:'2026-08-01T02:00:00Z'}} };
  const result = merge(cloud, incoming);
  assert.equal(result.profile.name, '相棒');
  assert.equal(result.profile.medicalHistory, '既往歴');
});

test('GAS merge preserves wishes from separate devices', () => {
  const base = {
    schemaVersion: 3, meta:{updatedAt:'2026-08-01T00:00:00Z'}, profile:{}, scores:{}, scoreUpdatedAt:{}, settings:{},
    records:[], goals:[], habits:[], wishes:[], healthItems:[], timeline:[], comparisons:[], products:[], reviews:[], simulations:[], aiHistory:[]
  };
  const cloud = { ...base, wishes:[{id:'want-1',kind:'wish',title:'キャンピングカー',updatedAt:'2026-08-01T01:00:00Z'}] };
  const incoming = { ...base, wishes:[{id:'place-1',kind:'wish',title:'北海道',updatedAt:'2026-08-01T02:00:00Z'}] };
  const result = merge(cloud,incoming);
  assert.equal(result.wishes.length,2);
});

test('GAS scoped context blocks sensitive domains across every collection', () => {
  const state = {
    profile:{ name:'相棒', medicalHistory:'病歴', family:'家族', location:'福井県' },
    scores:{ health:10, family:20, income:30, work:70, freedom:70 },
    records:[{id:'r1',domain:'income'}],
    goals:[{id:'g1',domain:'health'}],
    habits:[{id:'h1',domain:'family'}],
    wishes:[], healthItems:[],
    timeline:[{id:'t1',domain:'income'}],
    products:[{id:'p1',domain:'income'}], reviews:[], aiHistory:[]
  };
  const scopes = {
    basicProfile:true, scores:true, recentRecords:true, goals:true, habits:true,
    wishes:true, timeline:true, products:true, reviews:false,
    health:false, family:false, location:false, finance:false, aiHistory:false
  };
  context.__state = structuredClone(state);
  context.__scopes = structuredClone(scopes);
  const result = vm.runInContext('buildScopedContext_(__state, __scopes)', context);
  assert.equal(result.profile.medicalHistory, undefined);
  assert.equal(result.profile.family, undefined);
  assert.equal(result.profile.location, undefined);
  assert.equal(result.scores.health, undefined);
  assert.equal(result.scores.family, undefined);
  assert.equal(result.scores.income, undefined);
  assert.equal(result.lifeScore, 70);
  assert.equal(result.recentRecords.length, 0);
  assert.equal(result.goals.length, 0);
  assert.equal(result.habits.length, 0);
  assert.equal(result.timeline.length, 0);
  assert.equal(result.products.length, 0);
});
