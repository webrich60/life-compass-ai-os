import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeExternalUrl, normalizeRecord, normalizeState } from '../src/model.js';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

test('web URLs are normalized and unsafe schemes are rejected', () => {
  assert.equal(normalizeExternalUrl('example.com/item?id=3'), 'https://example.com/item?id=3');
  assert.equal(normalizeExternalUrl('https://maps.google.com/place/test'), 'https://maps.google.com/place/test');
  assert.equal(normalizeExternalUrl('javascript:alert(1)'), '');
  assert.equal(normalizeExternalUrl('file:///etc/passwd'), '');
  assert.equal(normalizeExternalUrl('https://user:secret@example.com/'), '');
  assert.equal(normalizeExternalUrl('2026-07-26T05:51:10.799Z'), '');
});

test('record links survive normalization in the common details field', () => {
  const record = normalizeRecord({ title:'京都の宿', linkUrl:'https://example.jp/inn' }, 'wish');
  assert.equal(record.details.referenceUrl, 'https://example.jp/inn');

  const state = normalizeState({
    wishes:[{ id:'wish-1', title:'行きたい場所', details:{ referenceUrl:'maps.example.jp/place' } }]
  });
  assert.equal(state.wishes[0].details.referenceUrl, 'https://maps.example.jp/place');
});

test('every record form exposes one synced reference URL and renders safe links', () => {
  assert.match(app, /name="referenceUrl"/);
  assert.match(app, /関連URL（商品・場所・体験のページ）/);
  assert.match(app, /関連URL（参考ページ・地図・予約ページなど）/);
  assert.match(app, /rel="noopener noreferrer"/);
  assert.match(app, /details\.referenceUrl = referenceUrl/);
});
