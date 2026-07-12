import type { Env } from './workflow';
export { AuditWorkflow } from './workflow';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, service: 'citely-phase1' });
    if (!authorized(request, env.OPERATOR_API_KEY)) return Response.json({ error: 'unauthorized' }, { status: 401 });

    const start = url.pathname.match(/^\/v1\/audit-runs\/([^/]+)\/start$/);
    if (request.method === 'POST' && start) {
      const auditRunId = decodeURIComponent(start[1]);
      const instanceId = `audit-${auditRunId}`;
      try {
        const instance = await env.AUDIT_WORKFLOW.create({ id: instanceId, params: { auditRunId } });
        return Response.json({ auditRunId, workflowInstanceId: instance.id }, { status: 202 });
      } catch (error) {
        const existing = await env.AUDIT_WORKFLOW.get(instanceId);
        return Response.json({ auditRunId, workflowInstanceId: existing.id, status: await existing.status(), reused: true }, { status: 200 });
      }
    }

    const status = url.pathname.match(/^\/v1\/workflows\/([^/]+)$/);
    if (request.method === 'GET' && status) {
      const instance = await env.AUDIT_WORKFLOW.get(decodeURIComponent(status[1]));
      return Response.json(await instance.status());
    }

    return Response.json({ error: 'not_found' }, { status: 404 });
  }
} satisfies ExportedHandler<Env>;

function authorized(request: Request, expected: string) {
  const actual = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!actual || !expected || actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < actual.length; index += 1) mismatch |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return mismatch === 0;
}
