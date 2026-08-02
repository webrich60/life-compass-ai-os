import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, normalizeRecord } from '../src/model.js';
import { inspectLegacyJson, applyMigration, inspectLegacyJsonBatch, applyMigrationBatch } from '../src/migration.js';

test('legacy profile and arrays are previewed before application', () => {
  const current = createEmptyState();
  const preview = inspectLegacyJson({ profile:{name:'相棒'}, mind_goals:[{title:'歩く',body:'10分'}] }, current);
  assert.equal(preview.stats.imported, 1);
  assert.equal(current.profile.name, '');
  const merged = applyMigration(current, preview, { profile:'fill_empty', conflict:'current' });
  assert.equal(merged.profile.name, '相棒');
  assert.equal(merged.goals.length, 1);
});

test('content duplicate is not added twice', () => {
  const current = createEmptyState();
  current.records.push(normalizeRecord({id:'new-1',title:'同じ記録',body:'内容',date:'2026-08-01'},'record'));
  const preview = inspectLegacyJson({records:[{id:'old-9',title:'同じ記録',body:'内容',date:'2026-08-01'}]}, current);
  assert.equal(preview.stats.duplicates, 1);
  const merged = applyMigration(current, preview, {profile:'current',conflict:'current'});
  assert.equal(merged.records.length, 1);
});

test('same id conflict can keep both records', () => {
  const current = createEmptyState();
  current.records.push(normalizeRecord({id:'r1',title:'PC',body:'PC側',date:'2026-08-01'},'record'));
  const preview = inspectLegacyJson({records:[{id:'r1',title:'スマホ',body:'スマホ側',date:'2026-08-01'}]}, current);
  assert.equal(preview.stats.conflicts, 1);
  const merged = applyMigration(current, preview, {profile:'current',conflict:'keep_both'});
  assert.equal(merged.records.length, 2);
});

test('real v4.x buckets are all routed without losing AI history', () => {
  const preview = inspectLegacyJson({
    current:[{id:'c1',category:'体調',title:'現在',body:'本文',createdAt:'2026-07-01T00:00:00Z'}],
    mind:[{id:'m1',category:'不安',title:'気持ち',body:'本文',createdAt:'2026-07-02T00:00:00Z'}],
    insights:[{id:'i1',category:'学び',title:'気づき',body:'本文',createdAt:'2026-07-03T00:00:00Z'}],
    reflections:[{id:'r1',category:'体調管理',title:'振り返り',body:'本文',createdAt:'2026-07-04T00:00:00Z'}],
    premises:[{id:'p1',category:'お金',title:'前提',body:'本文',createdAt:'2026-07-05T00:00:00Z'}],
    future:[{id:'f1',category:'行きたい場所',title:'未来',body:'本文',createdAt:'2026-07-06T00:00:00Z'}],
    goals:[{id:'g1',category:'健康',title:'目標',body:'本文',createdAt:'2026-07-07T00:00:00Z'}],
    aiHistory:[{id:'a1',provider:'gemini',mode:'総合診断',question:'質問',answer:'回答',createdAt:'2026-07-08T00:00:00Z'}]
  });
  assert.equal(preview.candidate.records.length, 4);
  assert.equal(preview.candidate.reviews.length, 1);
  assert.equal(preview.candidate.goals.length, 1);
  assert.equal(preview.candidate.wishes.length, 1);
  assert.equal(preview.candidate.aiHistory.length, 1);
  assert.equal(preview.candidate.records.find(x=>x.id==='c1').domain, 'health');
  assert.equal(preview.candidate.records.find(x=>x.id==='p1').domain, 'income');
});

test('nested sync payload restores the deepest original and removes payload bloat', () => {
  const original={id:'legacy-1',category:'行きたい場所',title:'知覧',body:'行きたい',createdAt:'2026-07-26T05:42:33.318Z',updatedAt:'2026-07-26T05:42:33.320Z',linkUrl:'https://example.com/',tags:'旅、自由'};
  const damaged={...original,createdAt:'旅、自由',updatedAt:'2026-07-27T00:00:00Z',linkUrl:'2026-07-26T05:42:33.318Z',driveViewUrl:JSON.stringify({action:'syncAll',raw:original})};
  const preview=inspectLegacyJson({future:[damaged]});
  const row=preview.candidate.wishes[0];
  assert.equal(row.createdAt, original.createdAt);
  assert.equal(row.date, '2026-07-26');
  assert.deepEqual(row.tags, ['旅','自由']);
  assert.equal(row.legacy.sourceLink, 'https://example.com/');
  assert.equal(row.details.referenceUrl, 'https://example.com/');
  assert.equal(preview.stats.repaired, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(row, 'driveViewUrl'), false);
  assert.equal(JSON.stringify(row).includes('syncAll'), false);
});

test('legacy profile maps named fields and creates timeline and comparison records', () => {
  const preview=inspectLegacyJson({profile:{name:'相棒',familyStructure:'家族',likedThings:'旅',strongThings:'販売',personalityTraits:'慎重',lifeTimeline:'人生年表',pastIdealLife:'過去の理想',currentReality:'現在',newDesiredLife:'新しい理想',updatedAt:'2026-08-01T00:00:00Z'}});
  assert.equal(preview.candidate.profile.family, '家族');
  assert.equal(preview.candidate.profile.likes, '旅');
  assert.equal(preview.candidate.profile.strengths, '販売');
  assert.equal(preview.candidate.profile.personality, '慎重');
  assert.equal(preview.candidate.timeline.length, 1);
  assert.equal(preview.candidate.comparisons.length, 1);
});

test('duplicate AI responses are counted and imported once', () => {
  const common={provider:'gemini',model:'gemini-2.5-flash',mode:'総合診断',question:'同じ質問',answer:'同じ回答'};
  const preview=inspectLegacyJson({aiHistory:[{...common,id:'a1',createdAt:'2026-08-01T00:00:00Z'},{...common,id:'a2',createdAt:'2026-08-01T00:00:01Z'}]});
  assert.equal(preview.stats.duplicates, 1);
  assert.equal(preview.candidate.aiHistory.length, 1);
});

test('smartphone and PC backups can be previewed and applied as one batch', () => {
  const shared={id:'shared',title:'共通',body:'共通本文',createdAt:'2026-08-01T00:00:00Z'};
  const smartphone={
    profile:{name:'相棒',medicalHistory:'既往歴',values:'価値観'},
    mind:[shared,{id:'smart-only',title:'スマホのみ',body:'気づき'}],
    aiHistory:[{id:'a1',provider:'gemini',question:'共通質問',answer:'共通回答'}]
  };
  const pc={
    profile:{name:'相棒'},
    mind:[shared],
    aiHistory:[
      {id:'a2',provider:'gemini',question:'共通質問',answer:'共通回答'},
      {id:'a3',provider:'openai',question:'PCだけ',answer:'PC回答'}
    ]
  };
  const preview=inspectLegacyJsonBatch([pc,smartphone],createEmptyState());
  assert.equal(preview.stats.sourceCount,2);
  assert.equal(preview.stats.conflicts,0);
  const merged=applyMigrationBatch(createEmptyState(),preview,{profile:'fill_empty',conflict:'current'});
  assert.equal(merged.records.length,2);
  assert.equal(merged.aiHistory.length,2);
  assert.equal(merged.profile.medicalHistory,'既往歴');
  assert.equal(merged.profile.values,'価値観');
});

test('new OS backup keeps wish records as the supported wish kind', () => {
  const preview = inspectLegacyJson({
    format:'LifeCompassAIOS',
    state:{wishes:[{id:'wish-1',kind:'wish',domain:'freedom',title:'北海道',details:{wishType:'行きたい場所'}}]}
  });
  assert.equal(preview.candidate.wishes.length,1);
  assert.equal(preview.candidate.wishes[0].kind,'wish');
  assert.equal(preview.candidate.wishes[0].details.wishType,'行きたい場所');
});

test('integrated v2 migration data routes embedded future goals to wishes', () => {
  const preview = inspectLegacyJson({
    format:'LifeCompassAIOS',
    state:{
      schemaVersion:2,
      goals:[
        {id:'goal-1',title:'収入目標',legacy:{originalSection:'goals',originalCategory:'お金'}},
        {id:'future-1',title:'新月亭',legacy:{originalSection:'future',originalCategory:'行きたい場所'}}
      ]
    }
  });
  assert.equal(preview.candidate.goals.length,1);
  assert.equal(preview.candidate.wishes.length,1);
  assert.equal(preview.candidate.wishes[0].details.wishType,'行きたい場所');
});

test('legacy future experiences are not mistaken for wanted items', () => {
  const preview = inspectLegacyJson({
    future:[
      {id:'challenge-1',category:'やりたい事',title:'Kindle出版に挑戦'},
      {id:'experience-1',category:'叶えたい夢',title:'人生で一度は気球に乗る'}
    ]
  });
  assert.equal(preview.candidate.wishes.length,2);
  assert.ok(preview.candidate.wishes.every(row=>row.details.wishType==='やってみたいこと・挑戦・体験'));
  assert.equal(preview.candidate.wishes.find(row=>row.id==='challenge-1').details.experienceType,'挑戦・成長');
  assert.equal(preview.candidate.wishes.find(row=>row.id==='experience-1').details.experienceType,'人生で一度は');
});
