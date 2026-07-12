import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MockProvider, aggregateScores, analyzeEntities, classifyCitation,
  extractOpenAIOutput, findEntityMentions, runAudit, scoreObservation,
  validateAuditConfig
} from '../src/citely.mjs';

const valid = {
  auditId: 'a1',
  brand: { name: 'Citely', domain: 'citely.example', aliases: ['Citely'] },
  competitors: [{ id: 'brightreach', name: 'BrightReach', domain: 'brightreach.example', aliases: ['BrightReach'] }],
  prompts: [{ id: 'p1', text: 'Best tool?', stage: 'comparison', importance: 5 }]
};

test('validates and normalizes config', () => {
  const config = validateAuditConfig(valid);
  assert.equal(config.geography, 'India');
  assert.ok(config.brand.aliases.includes('citely.example'));
});

test('rejects duplicate prompt ids', () => {
  assert.throws(() => validateAuditConfig({ ...valid, prompts: [valid.prompts[0], valid.prompts[0]] }), /duplicate prompt id/);
});

test('matches aliases without substring false positives', () => {
  assert.equal(findEntityMentions('Linear is useful.', { name: 'Linear', aliases: ['Linear'] }).length, 1);
  assert.equal(findEntityMentions('A nonlinear system.', { name: 'Linear', aliases: ['Linear'] }).length, 0);
});

test('separates brand and competitor mentions', () => {
  const result = analyzeEntities('Citely is stronger than BrightReach.', valid.brand, valid.competitors);
  assert.equal(result.brand.mentioned, true);
  assert.ok(result.brand.firstIndex < result.competitors[0].firstIndex);
});

test('classifies citation ownership', () => {
  assert.equal(classifyCitation('https://docs.citely.example/a', 'citely.example').type, 'brand-owned');
  assert.equal(classifyCitation('broken', 'citely.example').type, 'invalid');
});

test('scores and aggregates completed observations', () => {
  const score = scoreObservation({ prompt: { importance: 5 }, citations: [], entities: { brand: { mentioned: true, firstIndex: 10 }, competitors: [{ mentioned: true, firstIndex: 100 }] } });
  assert.equal(score.mentionStatus, 4);
  const summary = aggregateScores([{ status: 'completed', prompt: { stage: 'comparison' }, score }]);
  assert.equal(summary.mentionRate, 1);
});

test('extracts OpenAI citation annotations', () => {
  const output = extractOpenAIOutput({ output: [{ content: [{ type: 'output_text', text: 'Answer', annotations: [{ url: 'https://example.com/a' }, { url_citation: { url: 'https://example.com/b' } }] }] }] });
  assert.deepEqual(output, { text: 'Answer', citations: ['https://example.com/a', 'https://example.com/b'] });
});

test('runs the complete audit pipeline', async () => {
  const run = await runAudit({ config: validateAuditConfig(valid), providers: [new MockProvider()] });
  assert.equal(run.observations[0].status, 'completed');
  assert.equal(run.summary.totalObservations, 1);
});
