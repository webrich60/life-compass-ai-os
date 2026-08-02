import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, normalizeRecord } from '../src/model.js';
import { mergeStates } from '../src/storage.js';

test('record existing only on smartphone survives merge', () => {
  const pc=createEmptyState(), phone=createEmptyState();
  phone.records.push(normalizeRecord({id:'phone-13',title:'スマホだけの記録',updatedAt:'2026-08-01T01:00:00Z'},'record'));
  const merged=mergeStates(pc,phone);
  assert.equal(merged.records.length,1);
  assert.equal(merged.records[0].id,'phone-13');
});

test('wishes created on separate devices are both preserved', () => {
  const pc=createEmptyState(), phone=createEmptyState();
  pc.wishes.push(normalizeRecord({id:'want-1',title:'キャンピングカー',details:{wishType:'欲しいもの'},updatedAt:'2026-08-01T01:00:00Z'},'wish'));
  phone.wishes.push(normalizeRecord({id:'place-1',title:'北海道',details:{wishType:'行きたい場所'},updatedAt:'2026-08-01T02:00:00Z'},'wish'));
  const merged=mergeStates(pc,phone);
  assert.equal(merged.wishes.length,2);
  assert.ok(merged.wishes.find(x=>x.id==='want-1'));
  assert.ok(merged.wishes.find(x=>x.id==='place-1'));
});

test('a related URL saved on one device reaches the other device through merge', () => {
  const pc=createEmptyState(), phone=createEmptyState();
  phone.wishes.push(normalizeRecord({
    id:'place-link-1', title:'京都の旅館', updatedAt:'2026-08-02T03:00:00Z',
    details:{wishType:'行きたい場所',referenceUrl:'https://example.jp/kyoto'}
  },'wish'));
  const merged=mergeStates(pc,phone);
  assert.equal(merged.wishes[0].details.referenceUrl,'https://example.jp/kyoto');
});

test('newer same-id record wins without deleting unrelated items', () => {
  const pc=createEmptyState(), phone=createEmptyState();
  pc.records.push(normalizeRecord({id:'shared',title:'古い',updatedAt:'2026-07-01T00:00:00Z'},'record'));
  pc.records.push(normalizeRecord({id:'pc-only',title:'PCのみ'},'record'));
  phone.records.push(normalizeRecord({id:'shared',title:'新しい',updatedAt:'2026-08-01T00:00:00Z'},'record'));
  const merged=mergeStates(pc,phone);
  assert.equal(merged.records.length,2);
  assert.equal(merged.records.find(x=>x.id==='shared').title,'新しい');
  assert.ok(merged.records.find(x=>x.id==='pc-only'));
});

test('profile fields edited on different devices are both preserved', () => {
  const pc=createEmptyState(), phone=createEmptyState();
  pc.profile.name='相棒'; pc.profile.fieldUpdatedAt.name='2026-08-01T01:00:00Z';
  phone.profile.medicalHistory='既往歴'; phone.profile.fieldUpdatedAt.medicalHistory='2026-08-01T02:00:00Z';
  const merged=mergeStates(pc,phone);
  assert.equal(merged.profile.name,'相棒');
  assert.equal(merged.profile.medicalHistory,'既往歴');
});

test('life scores edited in different domains are merged per domain', () => {
  const pc=createEmptyState(), phone=createEmptyState();
  pc.scores.health=70; pc.scoreUpdatedAt.health='2026-08-01T01:00:00Z';
  phone.scores.work=80; phone.scoreUpdatedAt.work='2026-08-01T02:00:00Z';
  const merged=mergeStates(pc,phone);
  assert.equal(merged.scores.health,70);
  assert.equal(merged.scores.work,80);
});

test('a newer tombstone wins so deleted records do not reappear', () => {
  const pc=createEmptyState(), phone=createEmptyState();
  pc.records.push(normalizeRecord({id:'deleted',title:'古い記録',updatedAt:'2026-08-01T01:00:00Z'},'record'));
  phone.records.push(normalizeRecord({id:'deleted',title:'古い記録',deletedAt:'2026-08-01T02:00:00Z',updatedAt:'2026-08-01T02:00:00Z'},'record'));
  const merged=mergeStates(pc,phone);
  assert.equal(merged.records[0].deletedAt,'2026-08-01T02:00:00Z');
});
