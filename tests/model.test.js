import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyState, normalizeRecord, normalizeState, calculateLifeScore,
  inferWishType, inferExperienceType
} from '../src/model.js';

test('new state has every life score and a stable schema', () => {
  const state = createEmptyState();
  assert.equal(state.schemaVersion, 4);
  assert.equal(Object.keys(state.scores).length, 8);
  assert.deepEqual(state.wishes, []);
  assert.equal(calculateLifeScore(state), 50);
});

test('wish records preserve type, budget, timing and realization status', () => {
  const row = normalizeRecord({
    title: '北海道へ行く', domain: 'freedom',
    details: { wishType: '行きたい場所', targetDate: '2027-06-01', budget: '30万円', wishStatus: '計画中' }
  }, 'wish');
  assert.equal(row.kind, 'wish');
  assert.equal(row.details.wishType, '行きたい場所');
  assert.equal(row.details.budget, '30万円');
  assert.equal(row.details.wishStatus, '計画中');
});

test('challenge and experience wishes preserve their subtype and first step', () => {
  const row = normalizeRecord({
    title: 'Kindleを出版する', domain: 'challenge',
    details: {
      wishType: 'やってみたいこと・挑戦・体験', experienceType: '挑戦・成長',
      firstStep: '目次案を作る', companion: '家族'
    }
  }, 'wish');
  assert.equal(row.details.wishType, 'やってみたいこと・挑戦・体験');
  assert.equal(row.details.experienceType, '挑戦・成長');
  assert.equal(row.details.firstStep, '目次案を作る');
  assert.equal(row.details.companion, '家族');
});

test('legacy wish labels are classified into the three new groups', () => {
  assert.equal(inferWishType('欲しいもの'), '欲しいもの');
  assert.equal(inferWishType('行きたい場所'), '行きたい場所');
  assert.equal(inferWishType('やりたい事'), 'やってみたいこと・挑戦・体験');
  assert.equal(inferExperienceType('資格取得への挑戦'), '挑戦・成長');
  assert.equal(inferExperienceType('人生で一度は気球に乗る'), '人生で一度は');
});

test('already imported v2.0.2 wishes are reclassified without another JSON import', () => {
  const state = normalizeState({
    schemaVersion:3,
    wishes:[{
      id:'imported-challenge',kind:'wish',title:'Kindleを出版する',source:'legacy-json',
      details:{wishType:'欲しいもの'},legacy:{originalSection:'future',originalCategory:'やりたい事'}
    }]
  });
  assert.equal(state.wishes[0].details.wishType,'やってみたいこと・挑戦・体験');
  assert.equal(state.wishes[0].details.experienceType,'挑戦・成長');
});

test('schema v2 future goals move into wishes without duplication', () => {
  const state = normalizeState({
    schemaVersion:2,
    goals:[
      {id:'goal-1',title:'月150万円',legacy:{originalSection:'goals',originalCategory:'お金'}},
      {id:'place-1',title:'知覧特攻平和会館',legacy:{originalSection:'future',originalCategory:'行きたい場所'}}
    ]
  });
  assert.equal(state.goals.length,1);
  assert.equal(state.wishes.length,1);
  assert.equal(state.wishes[0].kind,'wish');
  assert.equal(state.wishes[0].details.wishType,'行きたい場所');
});

test('legacy-shaped record is normalized without discarding text', () => {
  const row = normalizeRecord({ name: '血圧', memo: '朝 150/95', section: 'health' }, 'healthItem');
  assert.equal(row.title, '血圧');
  assert.equal(row.body, '朝 150/95');
  assert.equal(row.domain, 'health');
  assert.ok(row.id);
});
