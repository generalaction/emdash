/**
 * Tiny fetch wrapper that calls the emdash main-process HTTP loopback.
 * Adds auth headers automatically.
 */

import type { Identity } from './identity';

export class HttpClient {
  constructor(private readonly identity: Identity) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.identity.token}`,
      'X-Emdash-Instance-Id': this.identity.instanceId,
      'X-Emdash-Session-Id': this.identity.sessionId,
      'Content-Type': 'application/json',
    };
  }

  async get<T>(path: string, query?: Record<string, string | number | boolean>): Promise<T> {
    const url = new URL(path, this.identity.statusUrl);
    for (const [k, v] of Object.entries(query ?? {})) {
      url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`emdash-mcp: GET ${path} failed (${res.status})`);
    return (await res.json()) as T;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const url = new URL(path, this.identity.statusUrl);
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`emdash-mcp: POST ${path} failed (${res.status})`);
    return (await res.json()) as T;
  }

  async delete<T>(path: string): Promise<T> {
    const url = new URL(path, this.identity.statusUrl);
    const res = await fetch(url, { method: 'DELETE', headers: this.headers() });
    if (!res.ok) throw new Error(`emdash-mcp: DELETE ${path} failed (${res.status})`);
    return (await res.json()) as T;
  }
}
