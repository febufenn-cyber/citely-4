import { SupabaseRest } from './supabase';
import { comparePublishedSnapshots, createReportDraft, createShareLink, getReport, getReviewQueue, publishReport, reviewAuditItem, serveSharedReport } from './phase2-service';
import { addImplementationEvidence, createActionFinding, createIntervention, evaluateIntervention, getActionBoard, transitionIntervention } from './phase3-service';
import { authenticatePrincipal, canUsePlatformApi, deploymentHealth, getPilotConsole, recordAuthorizationEvent, renderPilotConsole, requireWorkspacePermission } from './phase4-service';
import { renderPortalHome } from './portal';
import type { Env } from './workflow';
export { AuditWorkflow } from './workflow';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const db = new SupabaseRest(env);
    const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID();
    try {
      if (url.pathname === '/health') return Response.json({ ...deploymentHealth(env), correlationId });
      if (request.method === 'GET' && url.pathname === '/portal') return renderPortalHome();
      const shared = url.pathname.match(/^\/share\/([^/]+)$/);
      if (request.method === 'GET' && shared) return await serveSharedReport(db, decodeURIComponent(shared[1]));

      const principal = await authenticatePrincipal(request, env, db);
      if (!principal) {
        try { await recordAuthorizationEvent(db, { principal: null, action: `${request.method} ${url.pathname}`, outcome: 'denied', correlationId }); } catch {}
        return Response.json({ error: 'unauthorized', correlationId }, { status: 401 });
      }

      const ops = url.pathname === '/ops' ? url.searchParams.get('workspace_id') : null;
      const pilot = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/pilot-console$/)?.[1] ?? null;
      if (request.method === 'GET' && (ops || pilot)) {
        const workspaceId = decodeURIComponent(ops ?? pilot!);
        await requireWorkspacePermission(db, principal, workspaceId, 'workspace:read');
        const data = await getPilotConsole(db, principal, workspaceId);
        await recordAuthorizationEvent(db, { principal, workspaceId, action: 'pilot_console.read', outcome: 'allowed', correlationId });
        return url.pathname === '/ops' ? renderPilotConsole(data) : Response.json({ ...data, correlationId });
      }

      const operation = request.method === 'GET' ? 'read' : /review/.test(url.pathname) ? 'review' : 'mutate';
      if (!canUsePlatformApi(principal, operation)) {
        await recordAuthorizationEvent(db, { principal, action: `${request.method} ${url.pathname}`, outcome: 'denied', correlationId });
        return Response.json({ error: 'forbidden', correlationId }, { status: 403 });
      }
      const actorId = principal.userId ?? request.headers.get('x-actor-id') ?? '';

      const start = url.pathname.match(/^\/v1\/audit-runs\/([^/]+)\/start$/);
      if (request.method === 'POST' && start) {
        const auditRunId = decodeURIComponent(start[1]);
        const instanceId = `audit-${auditRunId}`;
        try {
          const instance = await env.AUDIT_WORKFLOW.create({ id: instanceId, params: { auditRunId } });
          return Response.json({ auditRunId, workflowInstanceId: instance.id, correlationId }, { status: 202 });
        } catch {
          const existing = await env.AUDIT_WORKFLOW.get(instanceId);
          return Response.json({ auditRunId, workflowInstanceId: existing.id, status: await existing.status(), reused: true, correlationId });
        }
      }

      const workflowStatus = url.pathname.match(/^\/v1\/workflows\/([^/]+)$/);
      if (request.method === 'GET' && workflowStatus) {
        const instance = await env.AUDIT_WORKFLOW.get(decodeURIComponent(workflowStatus[1]));
        return Response.json({ status: await instance.status(), correlationId });
      }

      if (request.method === 'GET' && url.pathname === '/v1/review-queue') {
        const workspaceId = url.searchParams.get('workspace_id');
        if (!workspaceId) return Response.json({ error: 'workspace_id is required' }, { status: 400 });
        return Response.json({ items: await getReviewQueue(db, workspaceId), correlationId });
      }

      const review = url.pathname.match(/^\/v1\/audit-run-items\/([^/]+)\/review$/);
      if (request.method === 'POST' && review) { requireActor(actorId); return Response.json(await reviewAuditItem(db, decodeURIComponent(review[1]), actorId, await jsonBody(request))); }
      const draft = url.pathname.match(/^\/v1\/audit-runs\/([^/]+)\/report-draft$/);
      if (request.method === 'POST' && draft) { requireActor(actorId); return Response.json(await createReportDraft(db, decodeURIComponent(draft[1]), actorId, await jsonBody(request)), { status: 201 }); }
      const publish = url.pathname.match(/^\/v1\/reports\/([^/]+)\/publish$/);
      if (request.method === 'POST' && publish) { requireActor(actorId); return Response.json(await publishReport(db, decodeURIComponent(publish[1]), actorId)); }
      const share = url.pathname.match(/^\/v1\/reports\/([^/]+)\/share$/);
      if (request.method === 'POST' && share) { requireActor(actorId); const body = await jsonBody(request) as { expiresInHours?: number }; return Response.json(await createShareLink(db, { ...env, PUBLIC_BASE_URL: env.PUBLIC_BASE_URL ?? url.origin }, decodeURIComponent(share[1]), actorId, Number(body.expiresInHours ?? 72)), { status: 201 }); }
      const comparison = url.pathname.match(/^\/v1\/reports\/([^/]+)\/compare\/([^/]+)$/);
      if (request.method === 'POST' && comparison) { const current = await getReport(db, decodeURIComponent(comparison[1])); const baseline = await getReport(db, decodeURIComponent(comparison[2])); const a = current.versions?.[0]?.snapshot; const b = baseline.versions?.[0]?.snapshot; if (!a || !b) return Response.json({ error: 'both reports require at least one version' }, { status: 409 }); return Response.json(comparePublishedSnapshots(a, b)); }
      const actionBoard = url.pathname.match(/^\/v1\/brands\/([^/]+)\/action-board$/);
      if (request.method === 'GET' && actionBoard) return Response.json(await getActionBoard(db, decodeURIComponent(actionBoard[1])));
      const finding = url.pathname.match(/^\/v1\/report-versions\/([^/]+)\/findings$/);
      if (request.method === 'POST' && finding) { requireActor(actorId); return Response.json(await createActionFinding(db, decodeURIComponent(finding[1]), actorId, await jsonBody(request)), { status: 201 }); }
      const intervention = url.pathname.match(/^\/v1\/findings\/([^/]+)\/interventions$/);
      if (request.method === 'POST' && intervention) { requireActor(actorId); return Response.json(await createIntervention(db, decodeURIComponent(intervention[1]), actorId, await jsonBody(request)), { status: 201 }); }
      const transition = url.pathname.match(/^\/v1\/interventions\/([^/]+)\/transition$/);
      if (request.method === 'POST' && transition) { requireActor(actorId); return Response.json(await transitionIntervention(db, decodeURIComponent(transition[1]), actorId, await jsonBody(request))); }
      const implementationEvidence = url.pathname.match(/^\/v1\/interventions\/([^/]+)\/evidence$/);
      if (request.method === 'POST' && implementationEvidence) { requireActor(actorId); return Response.json(await addImplementationEvidence(db, decodeURIComponent(implementationEvidence[1]), actorId, await jsonBody(request)), { status: 201 }); }
      const evaluation = url.pathname.match(/^\/v1\/interventions\/([^/]+)\/evaluate$/);
      if (request.method === 'POST' && evaluation) { requireActor(actorId); return Response.json(await evaluateIntervention(db, decodeURIComponent(evaluation[1]), actorId, await jsonBody(request)), { status: 201 }); }
      const report = url.pathname.match(/^\/v1\/reports\/([^/]+)$/);
      if (request.method === 'GET' && report) return Response.json(await getReport(db, decodeURIComponent(report[1])));
      return Response.json({ error: 'not_found', correlationId }, { status: 404 });
    } catch (error) {
      const status = Number((error as Error & { status?: number }).status ?? 500);
      return Response.json({ error: status >= 500 ? 'internal_error' : 'request_error', message: error instanceof Error ? error.message : String(error), correlationId }, { status });
    }
  }
} satisfies ExportedHandler<Env>;

function requireActor(actorId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actorId)) {
    const error = new Error('authenticated user or valid x-actor-id is required') as Error & { status: number };
    error.status = 400;
    throw error;
  }
}
async function jsonBody(request: Request): Promise<any> {
  try { return await request.json(); }
  catch { const error = new Error('valid JSON body is required') as Error & { status: number }; error.status = 400; throw error; }
}
