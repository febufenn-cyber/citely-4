#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PROMPT_STAGES = new Set([
  'category-discovery', 'comparison', 'use-case',
  'trust-risk', 'purchase-decision', 'brand-understanding'
]);
const STATUS_LABELS = ['Absent', 'Passing', 'Relevant option', 'Strong recommendation', 'Primary recommendation'];

export class ProviderError extends Error {
  constructor(provider, message, cause) {
    super(`${provider}: ${message}`, { cause });
    this.name = 'ProviderError';
    this.provider = provider;
  }
}

export class OpenAIProvider {
  constructor({ apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL ?? 'gpt-5.5' } = {}) {
    if (!apiKey) throw new ProviderError('openai', 'OPENAI_API_KEY is not configured');
    this.apiKey = apiKey;
    this.model = model;
    this.name = 'openai';
  }

  async runPrompt(input) {
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          tools: [{ type: 'web_search' }],
          input: [
            `Answer this buyer question naturally for the ${input.geography} market.`,
            'Use current web evidence where useful. Do not optimize for any named company.',
            'Explain recommendation criteria and preserve source citations.',
            '', input.prompt
          ].join('\n')
        })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
      const output = extractOpenAIOutput(body);
      return normalizedAnswer({
        provider: this.name, model: body.model ?? this.model,
        text: body.output_text ?? output.text, citations: output.citations,
        raw: body, usage: body.usage ?? null
      });
    } catch (error) {
      throw new ProviderError(this.name, error.message, error);
    }
  }
}

export class PerplexityProvider {
  constructor({ apiKey = process.env.PERPLEXITY_API_KEY, model = process.env.PERPLEXITY_MODEL ?? 'sonar' } = {}) {
    if (!apiKey) throw new ProviderError('perplexity', 'PERPLEXITY_API_KEY is not configured');
    this.apiKey = apiKey;
    this.model = model;
    this.name = 'perplexity';
  }

  async runPrompt(input) {
    try {
      const response = await fetch('https://api.perplexity.ai/v1/sonar', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          search_mode: 'web',
          messages: [
            { role: 'system', content: `Answer buyer questions naturally for the ${input.geography} market and explain recommendation criteria.` },
            { role: 'user', content: input.prompt }
          ]
        })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? body?.detail?.[0]?.msg ?? `HTTP ${response.status}`);
      return normalizedAnswer({
        provider: this.name, model: body.model ?? this.model,
        text: body.choices?.[0]?.message?.content ?? '',
        citations: body.citations ?? body.search_results?.map((item) => item.url) ?? [],
        raw: body, usage: body.usage ?? null
      });
    } catch (error) {
      throw new ProviderError(this.name, error.message, error);
    }
  }
}

const MOCK_ANSWERS = {
  p1: ['For Indian B2B teams, BrightReach and Northstar are commonly considered. Citely is a newer specialist focused on AI answer visibility and evidence-backed recommendations.', ['https://example.com/brightreach-review', 'https://citely.example/']],
  p2: ['Alternatives to BrightReach include Northstar, SignalMap, and Citely. Citely may fit smaller agencies that need prompt-level evidence.', ['https://example.com/alternatives']],
  p3: ['A small Indian agency should compare BrightReach and SignalMap. I could not verify whether Citely currently offers white-label reporting.', ['https://example.com/agency-tools']],
  p4: ['Citely monitors whether AI assistants mention a brand, compares competitor visibility, and proposes content fixes. It appears to be early-stage.', ['https://citely.example/about']],
  p5: ['For evidence-backed AI visibility audits in India, Citely is a relevant specialist option. BrightReach has more integrations.', ['https://citely.example/methodology', 'https://example.com/geo-india']],
  p6: ['The main risks with Citely are limited operating history, dependence on third-party model APIs, and model-version comparability.', ['https://example.com/ai-monitoring-risks']]
};

export class MockProvider {
  constructor() { this.name = 'mock'; this.model = 'deterministic-phase-0-fixture'; }
  async runPrompt(input) {
    const [text, citations] = MOCK_ANSWERS[input.promptId] ?? [`No fixture exists for ${input.promptId}.`, []];
    return normalizedAnswer({ provider: this.name, model: this.model, text, citations, raw: { fixture: input.promptId } });
  }
}

export function createProvider(name) {
  if (name === 'mock') return new MockProvider();
  if (name === 'openai') return new OpenAIProvider();
  if (name === 'perplexity') return new PerplexityProvider();
  throw new Error(`Unsupported provider: ${name}`);
}

export function validateAuditConfig(config) {
  const errors = [];
  if (!config?.auditId) errors.push('auditId is required');
  if (!config?.brand?.name) errors.push('brand.name is required');
  if (!config?.brand?.domain) errors.push('brand.domain is required');
  if (!Array.isArray(config?.brand?.aliases) || !config.brand.aliases.length) errors.push('brand.aliases must not be empty');
  if (!Array.isArray(config?.competitors)) errors.push('competitors must be an array');
  if (!Array.isArray(config?.prompts) || !config.prompts.length) errors.push('prompts must not be empty');
  const ids = new Set();
  for (const [index, prompt] of (config?.prompts ?? []).entries()) {
    if (!prompt.id) errors.push(`prompts[${index}].id is required`);
    if (ids.has(prompt.id)) errors.push(`duplicate prompt id: ${prompt.id}`);
    ids.add(prompt.id);
    if (!prompt.text) errors.push(`prompts[${index}].text is required`);
    if (!PROMPT_STAGES.has(prompt.stage)) errors.push(`prompts[${index}].stage is invalid`);
    if (!Number.isFinite(prompt.importance) || prompt.importance < 1 || prompt.importance > 5) errors.push(`prompts[${index}].importance must be 1–5`);
  }
  if (errors.length) throw new Error(`Audit configuration is invalid:\n- ${errors.join('\n- ')}`);
  return {
    repetitions: 1, locale: 'en-IN', geography: 'India', ...config,
    brand: { ...config.brand, aliases: unique([config.brand.name, config.brand.domain, ...config.brand.aliases]) },
    competitors: config.competitors.map((item) => ({ ...item, aliases: unique([item.name, item.domain, ...(item.aliases ?? [])].filter(Boolean)) }))
  };
}

export function findEntityMentions(text, entity) {
  const mentions = [];
  for (const alias of entity.aliases ?? []) {
    const escaped = escapeRegExp(normalizeAlias(alias));
    if (!escaped) continue;
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, 'giu');
    for (const match of String(text ?? '').matchAll(pattern)) {
      mentions.push({ entity: entity.name, alias: match[2], index: (match.index ?? 0) + match[1].length });
    }
  }
  return dedupe(mentions, (item) => `${item.entity}:${item.index}:${item.alias.toLowerCase()}`).sort((a, b) => a.index - b.index);
}

export function analyzeEntities(text, brand, competitors) {
  const brandMentions = findEntityMentions(text, brand);
  return {
    brand: summarizeMentions(brand.name, brandMentions),
    competitors: competitors.map((competitor) => summarizeMentions(competitor.name, findEntityMentions(text, competitor), competitor.id))
  };
}

export function classifyCitation(url, brandDomain, competitorDomains = []) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    const brandHost = normalizeHost(brandDomain);
    const competitorHosts = competitorDomains.map(normalizeHost);
    const type = sameDomain(host, brandHost) ? 'brand-owned' : competitorHosts.some((domain) => sameDomain(host, domain)) ? 'competitor-owned' : 'third-party';
    return { url, host, type };
  } catch {
    return { url, host: null, type: 'invalid' };
  }
}

export function scoreObservation({ entities, citations, prompt }) {
  const competitorIndexes = entities.competitors.filter((item) => item.mentioned).map((item) => item.firstIndex);
  const earliestCompetitor = competitorIndexes.length ? Math.min(...competitorIndexes) : null;
  let mentionStatus = 0;
  if (entities.brand.mentioned) {
    mentionStatus = 2;
    if (earliestCompetitor === null || entities.brand.firstIndex < earliestCompetitor) mentionStatus = 3;
    if (entities.brand.firstIndex < 80) mentionStatus = 4;
  }
  return {
    mentionStatus,
    brandMentioned: entities.brand.mentioned,
    brandFirst: entities.brand.mentioned && (earliestCompetitor === null || entities.brand.firstIndex < earliestCompetitor),
    competitorCount: entities.competitors.filter((item) => item.mentioned).length,
    brandOwnedCitationCount: citations.filter((item) => item.type === 'brand-owned').length,
    thirdPartyCitationCount: citations.filter((item) => item.type === 'third-party').length,
    weightedPoints: mentionStatus * prompt.importance,
    possibleWeightedPoints: 4 * prompt.importance
  };
}

export function aggregateScores(observations) {
  const valid = observations.filter((item) => item.status === 'completed');
  const byStage = Object.fromEntries([...new Set(valid.map((item) => item.prompt.stage))].map((stage) => {
    const items = valid.filter((item) => item.prompt.stage === stage);
    return [stage, {
      observations: items.length,
      mentionRate: ratio(items.filter((item) => item.score.brandMentioned).length, items.length),
      averageMentionStatus: round(average(items.map((item) => item.score.mentionStatus)))
    }];
  }));
  return {
    totalObservations: valid.length,
    mentionRate: ratio(valid.filter((item) => item.score.brandMentioned).length, valid.length),
    firstMentionRate: ratio(valid.filter((item) => item.score.brandFirst).length, valid.length),
    weightedVisibility: ratio(sum(valid.map((item) => item.score.weightedPoints)), sum(valid.map((item) => item.score.possibleWeightedPoints))),
    byStage
  };
}

export async function runAudit({ config, providers, onProgress = () => {} }) {
  const startedAt = new Date().toISOString();
  const observations = [];
  for (const prompt of config.prompts) for (const provider of providers) for (let repetition = 1; repetition <= config.repetitions; repetition += 1) {
    const observation = { id: randomUUID(), prompt, provider: provider.name, model: provider.model, repetition, status: 'running', startedAt: new Date().toISOString() };
    onProgress({ type: 'started', observation });
    try {
      const answer = await provider.runPrompt({ promptId: prompt.id, prompt: prompt.text, geography: config.geography, locale: config.locale });
      const entities = analyzeEntities(answer.text, config.brand, config.competitors);
      const citations = answer.citations.map((url) => classifyCitation(url, config.brand.domain, config.competitors.map((item) => item.domain)));
      Object.assign(observation, { status: 'completed', completedAt: new Date().toISOString(), answer, entities, citations, score: scoreObservation({ entities, citations, prompt }) });
    } catch (error) {
      Object.assign(observation, { status: 'failed', completedAt: new Date().toISOString(), error: { name: error.name, message: error.message } });
    }
    observations.push(observation);
    onProgress({ type: observation.status, observation });
  }
  return {
    schemaVersion: 1, auditId: config.auditId, generatedAt: new Date().toISOString(), startedAt, completedAt: new Date().toISOString(),
    methodology: { geography: config.geography, locale: config.locale, repetitions: config.repetitions, providers: providers.map((item) => ({ name: item.name, model: item.model })) },
    config, observations, summary: aggregateScores(observations)
  };
}

export function renderMarkdownReport(run) {
  const completed = run.observations.filter((item) => item.status === 'completed');
  const strongest = [...completed].sort((a, b) => b.score.weightedPoints - a.score.weightedPoints).slice(0, 3);
  const gaps = [...completed].sort((a, b) => a.score.weightedPoints - b.score.weightedPoints).slice(0, 3);
  return `# Citely Phase 0 Audit — ${run.config.brand.name}\n\nGenerated: ${run.generatedAt}\n\n## Executive evidence snapshot\n\n- Valid observations: **${run.summary.totalObservations}**\n- Brand mention rate: **${percent(run.summary.mentionRate)}**\n- Brand appears before competitors: **${percent(run.summary.firstMentionRate)}**\n- Importance-weighted visibility: **${percent(run.summary.weightedVisibility)}**\n- Failed observations: **${run.observations.filter((item) => item.status === 'failed').length}**\n\n> Directional Phase 0 measurements, not universal rankings. Inspect prompt-level evidence before making a claim.\n\n## Visibility by buyer-intent stage\n\n| Stage | Observations | Mention rate | Average status |\n|---|---:|---:|---:|\n${Object.entries(run.summary.byStage).map(([stage, item]) => `| ${stage} | ${item.observations} | ${percent(item.mentionRate)} | ${item.averageMentionStatus.toFixed(2)} / 4 |`).join('\n')}\n\n## Strongest observations\n\n${strongest.map(renderObservation).join('\n\n')}\n\n## Largest gaps\n\n${gaps.map(renderObservation).join('\n\n')}\n\n## Human-review queue\n\nVerify entity context, citations, factual accuracy, recommendation strength, and causality before customer delivery.\n`;
}

export function renderHtmlReport(run) {
  const rows = run.observations.map((item) => item.status === 'failed'
    ? `<tr><td>${escapeHtml(item.prompt.id)}</td><td>${escapeHtml(item.provider)}</td><td colspan="5">Failed: ${escapeHtml(item.error.message)}</td></tr>`
    : `<tr><td>${escapeHtml(item.prompt.text)}</td><td>${escapeHtml(item.provider)} / ${escapeHtml(item.model)}</td><td>${STATUS_LABELS[item.score.mentionStatus]}</td><td>${item.score.brandFirst ? 'Yes' : 'No'}</td><td>${item.score.competitorCount}</td><td>${item.citations.length}</td><td><details><summary>Evidence</summary><p>${escapeHtml(item.answer.text)}</p>${citationList(item.citations)}</details></td></tr>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Citely audit — ${escapeHtml(run.config.brand.name)}</title><style>:root{font-family:Inter,ui-sans-serif,system-ui;color:#172033;background:#f6f7fb}body{margin:0}main{max-width:1180px;margin:auto;padding:40px 20px 80px}header,section{background:#fff;border:1px solid #e3e7ef;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 8px 24px rgba(25,34,55,.05)}h1{margin-top:0;font-size:clamp(2rem,5vw,3.25rem)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.metric{background:#f6f7fb;border-radius:12px;padding:16px}.metric strong{display:block;font-size:1.8rem;margin-top:6px}.table{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:.92rem}th,td{border-bottom:1px solid #e3e7ef;text-align:left;vertical-align:top;padding:12px 10px}th{background:#f6f7fb}pre{white-space:pre-wrap;font-family:inherit;line-height:1.55}small{color:#5c667a}</style></head><body><main><header><small>Citely Phase 0 evidence audit</small><h1>${escapeHtml(run.config.brand.name)}</h1><p>Generated ${escapeHtml(run.generatedAt)} for ${escapeHtml(run.methodology.geography)}.</p></header><section><h2>Evidence snapshot</h2><div class="grid"><div class="metric">Valid observations<strong>${run.summary.totalObservations}</strong></div><div class="metric">Mention rate<strong>${percent(run.summary.mentionRate)}</strong></div><div class="metric">Before competitors<strong>${percent(run.summary.firstMentionRate)}</strong></div><div class="metric">Weighted visibility<strong>${percent(run.summary.weightedVisibility)}</strong></div></div><p><small>Directional only. Inspect every underlying answer.</small></p></section><section><h2>Prompt-level evidence</h2><div class="table"><table><thead><tr><th>Prompt</th><th>Provider</th><th>Status</th><th>Before competitors</th><th>Competitors</th><th>Citations</th><th>Raw evidence</th></tr></thead><tbody>${rows}</tbody></table></div></section><section><h2>Operator summary</h2><pre>${escapeHtml(renderMarkdownReport(run))}</pre></section></main></body></html>`;
}

export function extractOpenAIOutput(body) {
  const contents = (body.output ?? []).flatMap((item) => item.content ?? []).filter((item) => item.type === 'output_text');
  return {
    text: contents.map((item) => item.text ?? '').join('\n').trim(),
    citations: unique(contents.flatMap((item) => item.annotations ?? []).map((item) => item.url ?? item.url_citation?.url).filter(Boolean))
  };
}

async function main() {
  const [, , command, ...argv] = process.argv;
  if (command !== 'audit') return printHelp(command ? 1 : 0);
  try {
    const args = parseArgs(argv);
    if (!args.config) throw new Error('--config is required');
    const config = validateAuditConfig(JSON.parse(await readFile(path.resolve(args.config), 'utf8')));
    const providers = String(args.provider ?? 'mock').split(',').map((name) => createProvider(name.trim()));
    const outputDir = path.resolve(args.out ?? `output/${new Date().toISOString().replace(/[:.]/g, '-')}`);
    await mkdir(outputDir, { recursive: true });
    console.log(`Running ${config.prompts.length} prompts × ${providers.length} provider(s) × ${config.repetitions} repetition(s)`);
    const run = await runAudit({ config, providers, onProgress: ({ type, observation }) => {
      if (type === 'completed') console.log(`✓ ${observation.prompt.id} · ${observation.provider}`);
      if (type === 'failed') console.error(`✗ ${observation.prompt.id} · ${observation.provider}: ${observation.error.message}`);
    }});
    await Promise.all([
      writeFile(path.join(outputDir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`),
      writeFile(path.join(outputDir, 'report.md'), renderMarkdownReport(run)),
      writeFile(path.join(outputDir, 'report.html'), renderHtmlReport(run))
    ]);
    console.log(`\nAudit complete\n- ${path.join(outputDir, 'run.json')}\n- ${path.join(outputDir, 'report.md')}\n- ${path.join(outputDir, 'report.html')}`);
    if (run.observations.some((item) => item.status === 'failed')) process.exitCode = 2;
  } catch (error) {
    console.error(`\nCitely failed: ${error.message}`);
    process.exitCode = 1;
  }
}

function normalizedAnswer({ provider, model, text, citations = [], raw = null, usage = null }) { return { provider, model, text: String(text ?? '').trim(), citations: unique(citations.filter(Boolean)), raw, usage }; }
function summarizeMentions(name, mentions, id) { return { ...(id ? { id } : {}), name, mentioned: mentions.length > 0, count: mentions.length, firstIndex: mentions[0]?.index ?? null, mentions }; }
function normalizeAlias(value) { return String(value ?? '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, ''); }
function normalizeHost(value) { return normalizeAlias(value).toLowerCase().replace(/\/.*$/, ''); }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function sameDomain(host, domain) { return Boolean(domain) && (host === domain || host.endsWith(`.${domain}`)); }
function unique(values) { return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))]; }
function dedupe(values, key) { const seen = new Set(); return values.filter((item) => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true; }); }
function sum(values) { return values.reduce((total, value) => total + value, 0); }
function average(values) { return values.length ? sum(values) / values.length : 0; }
function round(value) { return Math.round(value * 1000) / 1000; }
function ratio(a, b) { return b ? round(a / b) : 0; }
function percent(value) { return `${Math.round(value * 100)}%`; }
function renderObservation(item) { return `### ${item.prompt.text}\n\n- Provider: ${item.provider} / ${item.model}\n- Status: ${STATUS_LABELS[item.score.mentionStatus]}\n- Brand before competitors: ${item.score.brandFirst ? 'yes' : 'no'}\n- Citations: ${item.citations.length}\n\n> ${item.answer.text.slice(0, 450)}${item.answer.text.length > 450 ? '…' : ''}`; }
function citationList(items) { return items.length ? `<ul>${items.map((item) => `<li><a href="${escapeHtml(item.url)}">${escapeHtml(item.host ?? item.url)}</a> — ${escapeHtml(item.type)}</li>`).join('')}</ul>` : '<p><small>No citations returned.</small></p>'; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function parseArgs(argv) { const args = {}; for (let i = 0; i < argv.length; i += 2) { if (!argv[i]?.startsWith('--') || !argv[i + 1]) throw new Error(`Invalid arguments near ${argv[i] ?? 'end'}`); args[argv[i].slice(2)] = argv[i + 1]; } return args; }
function printHelp(exitCode = 0) { console.log('Usage: node src/citely.mjs audit --config examples/demo-audit.json --provider mock --out output/demo'); process.exitCode = exitCode; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
