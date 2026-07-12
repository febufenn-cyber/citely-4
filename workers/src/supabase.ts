export interface SupabaseEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export class SupabaseRest {
  constructor(private readonly env: SupabaseEnv) {}

  async select<T>(table: string, query: string): Promise<T[]> {
    return await this.request<T[]>(`/rest/v1/${table}?${query}`, { method: 'GET' });
  }

  async one<T>(table: string, query: string): Promise<T> {
    const rows = await this.select<T>(table, query);
    if (rows.length !== 1) throw new Error(`Expected one ${table} row, received ${rows.length}`);
    return rows[0];
  }

  async insert<T>(table: string, payload: unknown): Promise<T[]> {
    return await this.request<T[]>(`/rest/v1/${table}`, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    });
  }

  async patch<T>(table: string, query: string, payload: unknown): Promise<T[]> {
    return await this.request<T[]>(`/rest/v1/${table}?${query}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    });
  }

  async rpc<T>(functionName: string, payload: unknown): Promise<T> {
    return await this.request<T>(`/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.env.SUPABASE_URL.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        apikey: this.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {})
      }
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = body?.message ?? body?.details ?? body?.hint ?? `Supabase HTTP ${response.status}`;
      const error = new Error(message) as Error & { status?: number; body?: unknown };
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body as T;
  }
}
