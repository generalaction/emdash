import type { Identity } from './identity';

export class HttpClient {
  constructor(private readonly identity: Identity) {}

  async get(path: string, query?: Record<string, string | number | boolean>): Promise<unknown> {
    const url = new URL(path, this.identity.statusUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    return this.request(url, { method: 'GET' });
  }

  async post(path: string, body?: unknown): Promise<unknown> {
    const url = new URL(path, this.identity.statusUrl);
    return this.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  }

  private async request(url: URL, init: RequestInit): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${this.identity.token}`);
    headers.set('x-emdash-instance-id', this.identity.instanceId);
    headers.set('x-emdash-session-id', this.identity.sessionId);

    const response = await fetch(url, {
      ...init,
      headers,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message =
        typeof data === 'object' && data && 'error' in data
          ? String(data.error)
          : response.statusText;
      throw new Error(`emdash MCP request failed (${response.status}): ${message}`);
    }
    return data;
  }
}
