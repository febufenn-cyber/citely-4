import type { RunItem } from './provider';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  OPENAI_API_KEY?: string;
  PERPLEXITY_API_KEY?: string;
  AUDIT_WORKFLOW: Workflow;
  OPERATOR_API_KEY: string;
  PUBLIC_BASE_URL?: string;
  ENVIRONMENT?: string;
  BUILD_COMMIT?: string;
  SCHEMA_VERSION?: string;
}

export type WorkflowParams = { auditRunId: string };
export type AuditRun = {
  id: string;
  workspace_id: string;
  state: string;
  audit_budget_micros: number;
  actual_cost_micros: number;
  frozen_configuration: {
    brand: { id: string; name: string; domain: string; aliases: string[] };
    competitors: Array<{ id: string; name: string; domain?: string; aliases: string[] }>;
  };
  audit_run_items: RunItem[];
};
