const assert = require('node:assert/strict');
const code = file => require('../packages/server/dist/src/' + file);
const { prepareKnowledgeSearch, rankDownloadArticles } = code('modules/knowledge/retrieval.js');
const search = prepareKnowledgeSearch('Where can I download ExampleApp?');
assert.ok(search.keywords.includes('exampleapp'));
assert.equal(search.download, true);
assert.equal(rankDownloadArticles([
  { id: '1', title: 'ExampleApp installation', body: 'https://example.com/download', score: 1 },
  { id: '2', title: 'Troubleshooting', body: 'General help', score: 20 },
], search)[0].id, '1');
const { parseScope, offTopicReply } = code('modules/ai/support-scope.js');
const offTopic = { has_support_request: false, off_topic: true, scope_confidence: 0.99 };
assert.equal(parseScope(offTopic, false, '2+2?').outOfScope, true);
assert.equal(parseScope(offTopic, true, '2+2?').outOfScope, false);
assert.equal(parseScope({ ...offTopic, scope_confidence: 0.2 }, false).outOfScope, false);
assert.equal(parseScope({ ...offTopic, has_support_request: true }, false).outOfScope, false);
assert.equal(parseScope(offTopic, false, 'Installation error').outOfScope, false);
assert.ok(offTopicReply('pt-BR'));
const { buildMessages } = code('modules/ai/prompt.js');
const request = {
  productName: 'INTERNAL_ROUTING_LABEL', productDescription: 'PRIVATE_DESCRIPTION',
  instructions: null, language: 'en', history: [{ role: 'user', text: 'Hello' }], knowledge: [],
  rules: { onComplaint: true, onTechnicalFailure: true, onBillingOrAccount: true, minConfidence: 0.55, custom: [] },
  handoffKeywords: [], clarifyRounds: 0, maxClarifyRounds: 3, model: 'test', temperature: 0, maxOutputTokens: 100,
};
const prompt = JSON.stringify(buildMessages(request));
assert.ok(!prompt.includes('INTERNAL_ROUTING_LABEL'));
assert.ok(!prompt.includes('PRIVATE_DESCRIPTION'));
assert.ok(prompt.includes('No product-specific instructions have been configured'));
assert.ok(JSON.stringify(buildMessages({ ...request, instructions: 'Only support ExampleApp.' })).includes('Only support ExampleApp.'));
const client = code('modules/ai/openai-client.js');
client.chatCompletion = async () => ({ content: '{"action":"unsupported_action"}', model: 'test', usage: { promptTokens: 0, completionTokens: 0 } });
const { OpenAiProvider } = code('modules/ai/openai.provider.js');
(async () => {
  const provider = new OpenAiProvider();
  assert.equal((await provider.generate(request)).decision.action, 'handoff');
  client.chatCompletion = async () => ({ content: JSON.stringify({ action: 'reply', reply: 'Hello', confidence: 1, used_article_ids: [] }), model: 'test', usage: { promptTokens: 0, completionTokens: 0 } });
  assert.equal((await provider.generate(request)).decision.reply, 'Hello');
  console.log('PASS generic retrieval, scope boundaries, owner instructions, and provider decision validation');
})().catch(error => { console.error(error); process.exitCode = 1; });
