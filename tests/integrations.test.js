import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, normalizeState } from '../src/model.js';
import {
  buildScopedContext, buildCloneKnowledgeMarkdown,
  buildActionsOpenApiTemplate, estimateGeminiCost
} from '../src/integrations.js';

test('sensitive LINE and GPT scopes are off by default', () => {
  const state = createEmptyState();
  for (const channel of ['line', 'gpt']) {
    for (const key of ['reviews', 'health', 'family', 'location', 'finance', 'aiHistory']) {
      assert.equal(state.settings.integrations[channel].scopes[key], false);
    }
  }
});

test('scoped context excludes unapproved private data', () => {
  const state = createEmptyState();
  state.profile = {
    ...state.profile, name:'相棒', age:'61', birthDate:'1965-01-01', location:'福井県',
    family:'家族情報', medicalHistory:'病歴情報', trauma:'個人的な苦労', notes:'秘密メモ'
  };
  state.scores = { ...state.scores, health:0, family:0, income:0, work:70, freedom:70, happiness:70, challenge:70, learning:70 };
  state.records.push({ id:'income-1', domain:'income', title:'収入', deletedAt:null });
  state.goals.push({ id:'health-goal', domain:'health', title:'健康の目標', deletedAt:null });
  state.habits.push({ id:'family-habit', domain:'family', title:'家族の習慣', deletedAt:null });
  state.timeline.push({ id:'income-event', domain:'income', title:'金銭の転機', deletedAt:null });
  state.products.push({ id:'income-product', domain:'income', title:'収入商品の記録', deletedAt:null });
  const context = buildScopedContext(state, state.settings.integrations.gpt.scopes);
  assert.equal(context.profile.name, '相棒');
  assert.equal(context.profile.birthDate, undefined);
  assert.equal(context.profile.location, undefined);
  assert.equal(context.profile.family, undefined);
  assert.equal(context.profile.medicalHistory, undefined);
  assert.equal(context.profile.trauma, undefined);
  assert.equal(context.profile.notes, undefined);
  assert.equal(context.scores.income, undefined);
  assert.equal(context.scores.health, undefined);
  assert.equal(context.scores.family, undefined);
  assert.equal(context.lifeScore, 70);
  assert.equal(context.recentRecords.some(row => row.domain === 'income'), false);
  assert.equal(context.goals.some(row => row.domain === 'health'), false);
  assert.equal(context.habits.some(row => row.domain === 'family'), false);
  assert.equal(context.timeline.some(row => row.domain === 'income'), false);
  assert.equal(context.products.some(row => row.domain === 'income'), false);
  assert.equal(context.reviews, undefined);
});

test('approved private scopes are included without leaking connection secrets', () => {
  const state = createEmptyState();
  state.settings.gasUrl = 'https://secret.example/exec';
  state.settings.syncToken = 'super-secret-token';
  state.profile = { ...state.profile, name:'相棒', medicalHistory:'病歴情報', family:'家族情報', location:'福井県' };
  const scopes = { ...state.settings.integrations.gpt.scopes, health:true, family:true, location:true, finance:true };
  const context = buildScopedContext(state, scopes);
  assert.equal(context.profile.medicalHistory, '病歴情報');
  assert.equal(context.profile.family, '家族情報');
  assert.equal(context.profile.location, '福井県');
  assert.equal(typeof context.scores.income, 'number');
  const knowledge = buildCloneKnowledgeMarkdown(state, scopes);
  assert.equal(knowledge.includes('super-secret-token'), false);
  assert.equal(knowledge.includes('secret.example'), false);
});

test('Gemini standard estimate matches 10 questions per day simulation', () => {
  const result = estimateGeminiCost({
    questionsPerDay:10, inputTokens:4000, outputTokens:600, usdJpy:150,
    geminiInputPerMillionUsd:0.30, geminiOutputPerMillionUsd:2.50
  });
  assert.equal(result.monthlyQuestions, 300);
  assert.ok(Math.abs(result.monthlyYen - 121.5) < 0.0001);
});

test('Actions template contains placeholders and no credentials', () => {
  const text = JSON.stringify(buildActionsOpenApiTemplate());
  assert.match(text, /YOUR-SECURE-ENDPOINT/);
  assert.match(text, /X-Life-Compass-Key/);
  assert.doesNotMatch(text, /syncToken|super-secret|API_KEY/);
});

test('older state receives complete integration defaults', () => {
  const state = normalizeState({ settings:{ integrations:{ line:{ dailyLimit:7 } } } });
  assert.equal(state.settings.integrations.line.dailyLimit, 7);
  assert.equal(state.settings.integrations.line.provider, 'gemini');
  assert.equal(state.settings.integrations.gpt.scopes.health, false);
  assert.equal(state.settings.integrations.cost.questionsPerDay, 10);
});
