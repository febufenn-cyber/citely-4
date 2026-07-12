#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CostGuard } from './engine/costs.mjs';
import { ProviderExecutionError } from './engine/failures.mjs';
import { MeasurementEngine } from './engine/measurement-engine.mjs';
import { InMemoryMeasurementStore } from './engine/memory-store.mjs';
import { autoAcceptReviewQueue, finalizeReviewedRun } from './engine/review.mjs';

export function createDemoPlan() {
  return {
    id: 'run_phase1_demo_001',
    workspaceId: 'workspace_demo',
    promptPanelVersionId: 'panel_version_001',
    geography: { country: 'IN', region: 'Tamil Nadu' },
    locale: 'en-IN',
    repetitions: 2,
    brand: {
      id: 'brand_citely',
      name: 'Citely',
      domain: 'citely.example',
      aliases: ['Citely', 'citely.example']
    },
    competitors: [
      { id: 'competitor_brightreach', name: 'BrightReach', domain: 'brightreach.example', aliases: ['BrightReach'] },
      { id: 'competitor_signalmap', name: 'SignalMap', domain: 'signalmap.example', aliases: ['SignalMap'] }
    ],
    prompts: [
      {
        id: 'prompt_best_india',
        versionId: 'prompt_best_india_v1',
        text: 'Which AI visibility platform should an Indian B2B marketing team evaluate?',
        stage: 'purchase-decision',
        importance: 5,
        persona: 'B2B marketing lead'
      },
      {
        id: 'prompt_agency',
        versionId: 'prompt_agency_v1',
        text: 'What tools can an SEO agency use for evidence-backed AI visibility reporting?',
        stage: 'use-case',
        importance: 4,
        persona: 'SEO agency owner'
      }
    ],
    providerProfiles: [
      {
        id: 'profile_mock_grounded',
        provider: 'mock-grounded',
        model: 'fixture-grounded-v1',
        searchMode: 'web',
        geography: { country: 'IN' },
        locale: 'en-IN',
        cost: { fixedMicros: 1200 }
      },
      {
        id: 'profile_mock_flaky',
        provider: 'mock-flaky',
        model: 'fixture-flaky-v1',
        searchMode: 'web',
        geography: { country: 'IN' },
        locale: 'en-IN',
        cost: { fixedMicros: 1800 }
      }
    ]
  };
}

export class DemoProvider {
  constructor({ name, failFirstKeys = [] }) {
    this.name = name;
    this.failFirstKeys = new Set(failFirstKeys);
    this.calls = new Map();
  }

  async estimateCost(request) {
    return request.providerProfile.cost.fixedMicros;
  }

  async execute(request) {
    const calls = (this.calls.get(request.observationKey) ?? 0) + 1;
    this.calls.set(request.observationKey, calls);
    if (this.failFirstKeys.has(request.observationKey) && calls === 1) {
      throw new ProviderExecutionError('Fixture rate limit', { provider: this.name, status: 429, code: 'rate_limit' });
    }
    const citelyFirst = request.promptId === 'prompt_agency' || request.repetition === 2;
    const answerText = citelyFirst
      ? `Citely is a relevant evidence-first option. BrightReach has broader integrations, while SignalMap focuses on dashboards.`
      : `BrightReach is widely evaluated. Citely is a newer evidence-first option and SignalMap is another alternative.`;
    return {
      provider: this.name,
      requestedModel: request.providerProfile.model,
      reportedModel: request.providerProfile.model,
      providerRequestId: `${this.name}-${request.observationKey}-${calls}`,
      searchMode: request.providerProfile.searchMode,
      searchPerformed: true,
      geography: request.geography,
      answerText,
      citations: [
        { url: 'https://citely.example/methodology', title: 'Citely methodology' },
        { url: 'https://example.com/ai-visibility-tools', title: 'AI visibility tools' }
      ],
      sources: [
        { url: 'https://citely.example/methodology', title: 'Citely methodology' },
        { url: 'https://example.com/ai-visibility-tools', title: 'AI visibility tools' }
      ],
      usage: { input_tokens: 80, output_tokens: 120 },
      costMicros: request.providerProfile.cost.fixedMicros,
      rawResponse: { fixture: true, calls }
    };
  }
}

export async function runPhase1Demo(outputDir = 'output/phase1-demo') {
  const plan = createDemoPlan();
  const store = new InMemoryMeasurementStore();
  const created = store.createRun(plan);
  const flakyItem = store.listItems(plan.id).find((item) => item.providerProfile.provider === 'mock-flaky');
  const grounded = new DemoProvider({ name: 'mock-grounded' });
  const flaky = new DemoProvider({ name: 'mock-flaky', failFirstKeys: [flakyItem.id] });
  const providers = new Map([[grounded.name, grounded], [flaky.name, flaky]]);
  const costGuard = new CostGuard({ auditLimitMicros: 50_000, workspaceLimitMicros: 100_000, globalLimitMicros: 1_000_000 });
  const engine = new MeasurementEngine({ store, providers, costGuard, retryLimit: 2, sleep: async () => {} });

  const execution = await engine.executeRun(created.id);
  autoAcceptReviewQueue({ store, auditRunId: created.id });
  const finalized = finalizeReviewedRun({ store, auditRunId: created.id });
  const snapshot = store.snapshotRun(created.id);

  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'measurement-engine.json'), `${JSON.stringify({ execution, finalized, cost: costGuard.snapshot(), snapshot }, null, 2)}\n`);
  return { execution, finalized, cost: costGuard.snapshot(), snapshot, providers };
}

async function main() {
  const result = await runPhase1Demo();
  const attempts = result.snapshot.items.reduce((total, item) => total + item.attempts.length, 0);
  console.log('Citely Phase 1 measurement demo complete');
  console.log(`- run state: ${result.finalized.state}`);
  console.log(`- intended observations: ${result.snapshot.items.length}`);
  console.log(`- provider attempts: ${attempts}`);
  console.log(`- accepted observations: ${result.snapshot.items.filter((item) => item.state === 'accepted').length}`);
  console.log(`- cost: ${result.cost.spent.audit} micro-USD`);
  console.log('- artifact: output/phase1-demo/measurement-engine.json');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
