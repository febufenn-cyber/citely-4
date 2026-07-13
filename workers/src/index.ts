import { SupabaseRest } from './supabase';
import { comparePublishedSnapshots, createReportDraft, createShareLink, getReport, getReviewQueue, publishReport, reviewAuditItem, serveSharedReport } from './phase2-service';
import { renderPortalHome } from './portal';
import type { Env } from './workflow';
export { AuditWorkflow } from './workflow';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const db = new SupabaseRest(env);
    try {
      if (url.pathname === '/health') return Response.json({ ok: true, service: 'citely-phase2' });
      if (request.method === 'GET' && url.pathname === '/portal') return renderPortalHome();
      const shared = url.pathname.match(/^\/share\/([^/]+)$/);
      if (request.method === 'GET' && shared) return await serveSharedReport(db, decodeURIComponent(shared[1]));
      if (!authorized(request, env.OPERATOR_API_KEY)) return Response.json({ error: 'unauthorized' }, { status: 401 });
      const actorId = request.headers.get('x-actor-id') ?? '';

      const start = url.pathname.match(/^\/v1\/audit-runs\/([^/]+)\/start$/);
      if (request.method === 'POST' && start) {
        const auditRunId = decodeURIComponent(start[1]);
        const instanceId = `audit-${auditRunId}`;
        try {
          const instance = await env.AUDIT_WORKFLOW.create({ id: instanceId, params: { auditRunId } });
          return Response.json({ auditRunId, workflowInstanceId: instance.id }, { status: 202 });
        } catch {
          const existing = await env.AUDIT_WORKFLOW.get(instanceId);
          return Response.json({ auditRunId, workflowInstanceId: existing.id, status: await existing.status(), reused: true }, { status: 200 });
        }
      }

      const workflowStatus = url.pathname.match(/^\/v1\/workflows\/([^/]+)$/);
      if (request.method === 'GET' && workflowStatus) {
        const instance = await env.AUDIT_WORKFLOW.get(decodeURIComponent(workflowStatus[1]));
        return Response.json(await instance.status());
      }

      if (request.method === 'GET' && url.pathname === '/v1/review-queue') {
        const workspaceId = url.searchParams.get('workspace_id');
        if (!workspaceId) return Response.json({ error: 'workspace_id is required' }, { status: 400 });
        return Response.json({ items: await getReviewQueue(db, workspaceId) });
      }

      const review = url.pathname.match(/^\/v1\/audit-run-items\/([^/]+)\/review$/);
      if (request.method === 'POST' && review) {
        requireActor(actorId);
        return Response.json(await reviewAuditItem(db, decodeURIComponent(review[1]), actorId, await jsonBody(request)));
      }

      const draft = url.pathname.match(/^\/v1\/audit-runs\/([^/]+)\/report-draft$/);
      if (request.method === 'POST' && draft) {
        requireActor(actorId);
        return Response.json(await createReportDraft(db, decodeURIComponent(draft[1]), actorId, await jsonBody(request)), { status: 201 });
      }

      const publish = url.pathname.match(/^\/v1\/reports\/([^/]+)\/publish$/);
      if (request.method === 'POST' && publish) {
        requireActor(actorId);
        return Response.json(await publishReport(db, decodeURIComponent(publish[1]), actorId));
      }

      const share = url.pathname.match(/^\/v1\/reports\/([^/]+)\/share$/);
      if (request.method === 'POST' && share) {
        requireActor(actorId);
        const body = await jsonBody(request) as { expiresInHours?: number };
        return Response.json(await createShareLink(db, { ...env, PUBLIC_BASE_URL: env.PUBLIC_BASE_URL ?? url.origin }, decodeURIComponent(share[1]), actorId, Number(body.expiresInHours ?? 72)), { status: 201 });
      }

      const comparison = url.pathname.match(/^\/v1\/reports\/([^/]+)\/compare\/([^/]+)$/);
      if (request.method === 'POST' && comparison) {
        const current = await getReport(db, decodeURIComponent(comparison[1]));
        const baseline = await getReport(db, decodeURIComponent(comparison[2]));
        const currentSnapshot = current.versions?.[0]?.snapshot;
        const baselineSnapshot = baseline.versions?.[0]?.snapshot;
        if (!currentSnapshot || !baselineSnapshot) return Response.json({ error: 'both reports require at least one version' }, { status: 409 });
        return Response.json(comparePublishedSnapshots(currentSnapshot, baselineSnapshot));
      }

      const report = url.pathname.match(/^\/v1\/reports\/([^/]+)$/);
      if (request.method === 'GET' && report) return Response.json(await getReport(db, decodeURIComponent(report[1])));

      return Response.json({ error: 'not_found' }, { status: 404 });
    } catch (error) {
      const status = Number((error as Error & { status?: number }).status ?? 500);
      return Response.json({ error: status >= 500 ? 'internal_error' : 'request_error', message: error instanceof Error ? error.message : String(error) }, { status });
    }
  }
} satisfies ExportedHandler<Env>;

function authorized(request: Request, expected: string) {
  const actual = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!actual || !expected || actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < actual.length; index += 1) mismatch |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return mismatch === 0;
}
function requireActor(actorId: string) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actorId)) { const error = new Error('x-actor-id must be a valid user UUID') as Error & { status: number }; error.status = 400; throw error; } }
async function jsonBody(request: Request): Promise<any> { try { return await request.json(); } catch { const error = new Error('valid JSON body is required') as Error & { status: number }; error.status = 400; throw error; } }
