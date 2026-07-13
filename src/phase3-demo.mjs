import { mkdir, writeFile } from 'node:fs/promises';
import { buildActionBoard, createExperimentPlan, evaluateExperiment, transitionExperiment, transitionIntervention } from './phase3/actions.mjs';

const methodology = { promptPanelVersionId: 'panel-v1', providerProfilesFingerprint: 'profiles-v1', reportedModelsFingerprint: 'models-v1', searchModesFingerprint: 'web', geographyFingerprint: 'india', localeFingerprint: 'en-in', scoringModelVersion: 'visibility-v1', repetitions: 1 };
const evidence = (report, statuses) => statuses.map((status, index) => ({ observationId: `${report}-o${index}`, prompt: { id: `p${index}`, stableKey: `commercial-${index}`, text: `Commercial buyer prompt ${index + 1}`, importance: 5 }, provider: { profileId: 'openai-web', name: 'openai', searchMode: 'web' }, reviewedClassification: { mention_status: status }, stability: 'stable' }));
const baseline = { reportVersionId: 'report-baseline', publicationState: 'published', generatedAt: '2026-06-01T00:00:00.000Z', methodology, auditRun: { intendedObservations: 3, successfulObservations: 3 }, evidence: evidence('baseline', [0, 0, 1]) };
const current = { reportVersionId: 'report-current', publicationState: 'published', generatedAt: '2026-07-13T00:00:00.000Z', methodology, auditRun: { intendedObservations: 3, successfulObservations: 3 }, evidence: evidence('current', [2, 3, 2]) };

let intervention = { id: 'intervention-1', findingId: 'finding-1', state: 'draft', title: 'Publish an evidence-backed category comparison' };
intervention = transitionIntervention(intervention, 'approved', { at: '2026-06-02T00:00:00.000Z' });
intervention = transitionIntervention(intervention, 'in_progress', { at: '2026-06-03T00:00:00.000Z' });
intervention = transitionIntervention(intervention, 'implemented', { implementedAt: '2026-06-10T00:00:00.000Z' });

let experiment = createExperimentPlan({ workspaceId: 'workspace-1', brandId: 'brand-1', findingId: 'finding-1', interventionId: intervention.id, baselineReportVersionId: baseline.reportVersionId, baselineSnapshot: baseline, hypothesis: 'A transparent comparison page will improve commercial-prompt visibility.', mechanism: 'It gives answer engines explicit category and differentiation evidence.', targetPromptKeys: ['commercial-0', 'commercial-1', 'commercial-2'], targetProviders: ['openai'], primaryMetric: 'average_mention_status', minimumDelta: 1, minimumCompleteness: 0.9, minimumSampleSize: 3 });
experiment = transitionExperiment(experiment, 'approved');
experiment = transitionExperiment(experiment, 'running');
experiment = transitionExperiment(experiment, 'awaiting_measurement');
const evaluation = evaluateExperiment({ plan: experiment, baselineSnapshot: baseline, currentSnapshot: current, intervention, implementationEvidence: [{ type: 'url', url: 'https://example.com/category-comparison', capturedAt: '2026-06-10T00:00:00.000Z' }] });
const board = buildActionBoard({ findings: [{ id: 'finding-1', state: 'planned', title: 'Missing commercial comparison evidence' }], interventions: [intervention], experiments: [experiment], evaluations: [evaluation] });

await mkdir('output/phase3-demo', { recursive: true });
await writeFile('output/phase3-demo/action-experiment.json', `${JSON.stringify({ baseline, current, intervention, experiment, evaluation, board }, null, 2)}\n`);
console.log(`Phase 3 demo complete: ${evaluation.outcome}, delta ${evaluation.delta}, confidence ${evaluation.causalConfidence}`);
