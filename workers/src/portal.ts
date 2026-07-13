export type PublishedSnapshot = {
  schemaVersion: number;
  reportVersionId: string;
  title: string;
  executiveSummary: string;
  generatedAt: string;
  brand: { id?: string; name: string; domain?: string };
  auditRun: { id?: string; state?: string; completedAt?: string | null; promptPanelVersionId?: string; intendedObservations: number; successfulObservations: number; terminalFailures: number; excludedObservations: number };
  methodology: { promptPanelVersionId?: string; providerProfilesFingerprint?: string; reportedModelsFingerprint?: string; searchModesFingerprint?: string; geographyFingerprint?: string; localeFingerprint?: string; providers: string[]; reportedModels: string[]; searchModes: string[]; scoringModelVersion: string };
  scoring: { calculationId?: string; modelVersion?: string; inputObservationIds?: string[]; metrics: Record<string, unknown> };
  findings: Array<{ id?: string; type: string; title: string; summary: string; evidenceObservationIds?: string[]; confidence?: string; suggestedInvestigation?: string | null }>;
  nextMeasurement?: string | null;
  evidence: Array<{
    prompt: { text: string; stage: string; importance: number };
    provider: { name: string; requestedModel: string; reportedModel?: string; searchMode: string };
    answerText: string;
    reviewedClassification: Record<string, unknown>;
    stability?: string;
    citations: Array<{ url: string; title?: string; domain?: string; ownership?: string }>;
  }>;
  limitations: string[];
};

export function renderPortalHome() {
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Citely reports</title>${styles()}</head><body><main><header><span class="eyebrow">Citely</span><h1>Evidence-backed AI visibility reports</h1><p>Open the secure report link supplied by your Citely operator. Reports disclose methodology, reviewed evidence, failures, and limitations.</p></header></main></body></html>`);
}

export function renderPublishedReport(snapshot: PublishedSnapshot) {
  const metrics = snapshot.scoring.metrics;
  const evidence = snapshot.evidence.map((item) => `<tr><td><strong>${escapeHtml(item.prompt.text)}</strong><small>${escapeHtml(item.prompt.stage)} · importance ${item.prompt.importance}</small></td><td>${escapeHtml(item.provider.name)}<small>${escapeHtml(item.provider.reportedModel ?? item.provider.requestedModel)}</small></td><td>${statusLabel(item.reviewedClassification)}</td><td>${escapeHtml(item.stability ?? 'insufficient_sample')}</td><td><details><summary>Open evidence</summary><p>${escapeHtml(item.answerText)}</p>${sourceList(item.citations)}</details></td></tr>`).join('');
  const findings = snapshot.findings.length ? snapshot.findings.map((item) => `<article class="finding"><span>${escapeHtml(item.type)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p>${item.suggestedInvestigation ? `<p><strong>Investigate:</strong> ${escapeHtml(item.suggestedInvestigation)}</p>` : ''}</article>`).join('') : '<p>No customer-visible findings were published.</p>';
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(snapshot.title)}</title>${styles()}</head><body><main><header><span class="eyebrow">Citely evidence report · ${escapeHtml(snapshot.generatedAt)}</span><h1>${escapeHtml(snapshot.title)}</h1><p>${escapeHtml(snapshot.executiveSummary)}</p></header><section><h2>Evidence snapshot</h2><div class="grid"><div class="metric">Mention rate<strong>${percent(metric(metrics, 'mentionRate'))}</strong></div><div class="metric">Weighted visibility<strong>${percent(metric(metrics, 'weightedVisibility'))}</strong></div><div class="metric">Data completeness<strong>${percent(metric(metrics, 'dataCompleteness'))}</strong></div><div class="metric">Reviewed evidence<strong>${snapshot.evidence.length}</strong></div></div><p><small>${snapshot.auditRun.successfulObservations} successful of ${snapshot.auditRun.intendedObservations} intended; ${snapshot.auditRun.terminalFailures} terminal failures and ${snapshot.auditRun.excludedObservations} exclusions disclosed.</small></p></section><section><h2>Published findings</h2><div class="findings">${findings}</div></section><section><h2>Prompt-level evidence</h2><div class="table"><table><thead><tr><th>Prompt</th><th>Provider</th><th>Reviewed status</th><th>Stability</th><th>Evidence</th></tr></thead><tbody>${evidence}</tbody></table></div></section><section><h2>Methodology and limitations</h2><p>Providers: ${snapshot.methodology.providers.map(escapeHtml).join(', ')} · Models: ${snapshot.methodology.reportedModels.map(escapeHtml).join(', ')} · Search modes: ${snapshot.methodology.searchModes.map(escapeHtml).join(', ')} · Scoring: ${escapeHtml(snapshot.methodology.scoringModelVersion)}</p><ul class="limitations">${snapshot.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section></main></body></html>`);
}

export function renderShareError(status: number, message: string) {
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Report unavailable</title>${styles()}</head><body><main><header><span class="eyebrow">Citely</span><h1>Report unavailable</h1><p>${escapeHtml(message)}</p></header></main></body></html>`, status);
}

function html(body: string, status = 200) { return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } }); }
function metric(metrics: Record<string, unknown>, camel: string) { const snake = camel.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`); return Number(metrics[camel] ?? metrics[snake] ?? 0); }
function statusLabel(classification: Record<string, unknown>) { const value = Number(classification.mention_status ?? classification.mentionStatus ?? 0); return `<span class="pill">${['Absent','Passing mention','Relevant option','Strong recommendation','Primary recommendation'][value] ?? 'Unknown'}</span>`; }
function sourceList(items: PublishedSnapshot['evidence'][number]['citations']) { return items.length ? `<ul>${items.map((item) => `<li><a href="${escapeHtml(item.url)}" rel="noreferrer">${escapeHtml(item.title ?? item.domain ?? item.url)}</a> · ${escapeHtml(item.ownership ?? 'unknown')}</li>`).join('')}</ul>` : '<small>No inline citations returned.</small>'; }
function percent(value: number) { return Number.isFinite(value) ? `${Math.round((value <= 1 ? value * 100 : value))}%` : '—'; }
function escapeHtml(value: unknown) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string)); }
function styles() { return `<style>:root{font-family:Inter,ui-sans-serif,system-ui;color:#172033;background:#f5f7fb}*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:auto;padding:40px 20px 80px}header,section{background:#fff;border:1px solid #e2e7ef;border-radius:18px;padding:26px;margin-bottom:20px;box-shadow:0 10px 30px rgba(23,32,51,.05)}h1{font-size:clamp(2rem,5vw,3.5rem);margin:.25rem 0 1rem}h2{margin-top:0}.eyebrow,small{display:block;color:#687386;font-size:.82rem}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.metric{background:#f6f8fc;border-radius:14px;padding:18px}.metric strong{display:block;font-size:1.8rem;margin-top:8px}.findings{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}.finding{border:1px solid #e2e7ef;border-radius:14px;padding:18px}.finding span{font-size:.75rem;text-transform:uppercase;color:#687386}.table{overflow:auto}table{width:100%;border-collapse:collapse;font-size:.92rem}th,td{text-align:left;vertical-align:top;padding:13px 10px;border-bottom:1px solid #e7ebf2}th{background:#f6f8fc}details p{line-height:1.55}.pill{display:inline-block;padding:5px 9px;border-radius:999px;background:#eef2f8;font-weight:600}a{color:inherit}.limitations{color:#586277;line-height:1.6}</style>`; }
