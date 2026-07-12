declare module 'cloudflare:workers' {
  export type WorkflowEvent<T> = { payload: T; instanceId: string };
  export type WorkflowStep = {
    do<T>(name: string, callback: () => Promise<T>): Promise<T>;
    do<T>(name: string, config: Record<string, unknown>, callback: () => Promise<T>): Promise<T>;
  };
  export class WorkflowEntrypoint<Env, Params> {
    protected env: Env;
    run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<unknown>;
  }
  export class NonRetryableError extends Error {}
}

interface WorkflowInstance {
  id: string;
  status(): Promise<unknown>;
}

interface Workflow {
  create(options?: { id?: string; params?: unknown }): Promise<WorkflowInstance>;
  get(id: string): Promise<WorkflowInstance>;
}

type ExportedHandler<Env> = {
  fetch(request: Request, env: Env): Promise<Response>;
};
