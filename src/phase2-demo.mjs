import { mkdir, writeFile } from 'node:fs/promises';
import { buildReportSnapshot, compareReportSnapshots, createSignedShareToken, verifySignedShareToken } from './phase2/reporting.mjs';
import { renderPublishedReport } from './phase2/render.mjs';

const baselineInput = fixture('baseline-v1', 2, 'gpt-demo-1');
const currentInput = fixture('current-v1', 3, 'gpt-demo-1');
const baseline = buildReportSnapshot(baselineInput);
const current = buildReportSnapshot(currentInput);
const comparison = compareReportSnapshots(current, baseline);
const token = createSignedShareToken({ reportVersionId: current.reportVersionId, expiresAt: new Date(Date.now() + 86_400_000).toISOString() }, 'demo-secret');
const verified = verifySignedShareToken(token, 'demo-secret');

await mkdir('output/phase2-demo', { recursive: true });
await Promise.all([
  writeFile('output/phase2-demo/report.json', `${JSON.stringify(current, null, 2)}\n`),
  writeFile('output/phase2-demo/comparison.json', `${JSON.stringify(comparison, null, 2)}\n`),
  writeFile('output/phase2-demo/report.html', renderPublishedReport(current))
]);
console.log(JSON.stringify({ reportVersionId: current.reportVersionId, evidence: current.evidence.length, comparison: comparison.summary, shareTokenVerified: verified.valid }, null, 2));

function fixture(reportVersionId, mentionStatus, reportedModel) {
  const observations = [
    observation('obs-1', 'prompt-category', 'What are the best AI visibility tools for Indian agencies?', 'category-discovery', mentionStatus, reportedModel),
    observation('obs-2', 'prompt-trust', 'Is Citely reliable for evidence-backed reporting?', 'trust-risk', 3, reportedModel)
  ];
  return {
    reportId: 'report-citely-demo', reportVersionId, workspaceId: 'workspace-demo', publicationState: 'customer_ready',
    generatedAt: new Date().toISOString(),
    brand: { id: 'brand-citely', name: 'Citely', domain: 'citely.example' },
    auditRun: {
      id: `run-${reportVersionId}`, state: 'ready', promptPanelVersionId: 'panel-v1', repetitions: 1, completedAt: new Date().toISOString(),
      frozenConfiguration: { methodology: { geography: { country: 'IN' }, locale: 'en-IN', repetitions: 1 } }
    },
    scoreCalculation: {
      id: `score-${reportVersionId}`, scoringModelVersion: 'visibility-v1', inputObservationIds: observations.map((item) => item.id),
      metrics: { intendedObservations: 2, successfulObservations: 2, terminalFailures: 0, excludedObservations: 0, mentionRate: 1, weightedVisibility: (mentionStatus + 3) / 8, dataCompleteness: 1 }
    },
    observations,
    narrative: { title: `Citely AI visibility report — ${reportVersionId}`, executiveSummary: 'Citely is visible in both reviewed prompts, with stronger trust-stage performance.', nextMeasurement: 'Rerun after the next content release.' },
    findings: [{ id: 'finding-1', type: 'opportunity', title: 'Category discovery is the clearest improvement opportunity', summary: 'The brand is present but not yet the primary recommendation in category prompts.', evidenceObservationIds: ['obs-1'], confidence: 'medium-high', suggestedInvestigation: 'Review decision-stage comparison coverage.' }]
  };
}

function observation(id, stableKey, text, stage, mentionStatus, reportedModel) {
  return {
    id, auditRunItemId: `item-${id}`, repetition: 1,
    prompt: { id: `prompt-${id}`, stableKey, text, stage, importance: 5, persona: 'Agency owner', locale: 'en-IN', geography: { country: 'IN' } },
    provider: { profileId: 'profile-openai-web-v1', name: 'openai', requestedModel: 'gpt-demo', reportedModel, searchMode: 'web' },
    answerText: mentionStatus ? 'Citely is a relevant evidence-first option. BrightReach is another platform.' : 'BrightReach is a common option.',
    citations: [{ url: 'https://citely.example/methodology', title: 'Citely methodology', domain: 'citely.example', ownership: 'brand_owned' }],
    sources: [], receivedAt: new Date().toISOString(), stability: 'stable_positive',
    machineClassification: { mention_status: mentionStatus, brand_mentioned: mentionStatus > 0 },
    review: { decision: 'accepted', acceptedClassification: { mention_status: mentionStatus, brand_mentioned: mentionStatus > 0 }, notes: 'internal note must not publish' }
  };
}
