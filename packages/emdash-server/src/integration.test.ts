/**
 * End-to-end integration tests for the webhook → pending → ack flow.
 * Uses an in-memory SQLite DB and Fastify's inject() — no real HTTP port needed.
 */
import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import { initDb, getDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { webhookEvents } from './db/schema.js';
import { buildServer } from './server.js';
import type { Config } from './config.js';

const TEST_API_KEY = 'esk_testkey';
const TEST_TOKEN = 'wh_testtokenabcdef';
const TEST_SECRET = 'webhook-signing-secret';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    apiKey: TEST_API_KEY,
    port: 8080,
    host: '127.0.0.1',
    dbPath: ':memory:',
    signingSecrets: {},
    routes: [],
    ...overrides,
  };
}

function authHeader(apiKey = TEST_API_KEY) {
  return { Authorization: `Bearer ${apiKey}` };
}

function githubSignature(secret: string, body: string) {
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${sig}`;
}

beforeEach(() => {
  initDb(':memory:');
  runMigrations();
});

describe('Full webhook → pending → ack flow', () => {
  it('webhook stored as pending, appears in /api/events/pending, can be acked', async () => {
    const app = buildServer(makeConfig());

    // 1. Send a webhook
    const webhookRes = await app.inject({
      method: 'POST',
      url: `/webhook/${TEST_TOKEN}`,
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ action: 'opened', number: 42 }),
    });
    expect(webhookRes.statusCode).toBe(202);
    expect(JSON.parse(webhookRes.payload)).toEqual({ ok: true });

    // 2. Poll pending events (authenticated)
    const pendingRes = await app.inject({
      method: 'GET',
      url: '/api/events/pending',
      headers: authHeader(),
    });
    expect(pendingRes.statusCode).toBe(200);
    const { events } = JSON.parse(pendingRes.payload) as {
      events: Array<{ id: string; automationToken: string; source: string; payload: string; createdAt: number }>;
    };
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.automationToken).toBe(TEST_TOKEN);
    expect(event.source).toBe('generic');
    expect(JSON.parse(event.payload)).toEqual({ action: 'opened', number: 42 });

    // 3. Ack the event
    const ackRes = await app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/ack`,
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(ackRes.statusCode).toBe(200);

    // 4. Pending list is now empty
    const pendingAfterRes = await app.inject({
      method: 'GET',
      url: '/api/events/pending',
      headers: authHeader(),
    });
    const afterBody = JSON.parse(pendingAfterRes.payload) as { events: unknown[] };
    expect(afterBody.events).toHaveLength(0);

    // 5. Event is marked processed in the DB
    const db = getDb();
    const rows = await db.select().from(webhookEvents);
    expect(rows[0]!.status).toBe('processed');
    expect(rows[0]!.processedAt).toBeGreaterThan(0);
  });

  it('webhook acked with error is marked failed', async () => {
    const app = buildServer(makeConfig());

    await app.inject({
      method: 'POST',
      url: `/webhook/${TEST_TOKEN}`,
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ action: 'closed' }),
    });

    const pendingRes = await app.inject({
      method: 'GET',
      url: '/api/events/pending',
      headers: authHeader(),
    });
    const { events } = JSON.parse(pendingRes.payload) as { events: Array<{ id: string }> };
    const eventId = events[0]!.id;

    await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/ack`,
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      payload: JSON.stringify({ error: 'automation_busy' }),
    });

    const db = getDb();
    const rows = await db.select().from(webhookEvents);
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.error).toBe('automation_busy');
  });
});

describe('HMAC signature verification', () => {
  it('accepts webhook with valid GitHub HMAC signature', async () => {
    const app = buildServer(makeConfig({ signingSecrets: { [TEST_TOKEN]: TEST_SECRET } }));
    const body = JSON.stringify({ action: 'synchronize' });
    const sig = githubSignature(TEST_SECRET, body);

    const res = await app.inject({
      method: 'POST',
      url: `/webhook/${TEST_TOKEN}`,
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': sig,
        'x-github-event': 'pull_request',
      },
      payload: body,
    });
    expect(res.statusCode).toBe(202);

    // Source should be detected as github
    const pendingRes = await app.inject({
      method: 'GET',
      url: '/api/events/pending',
      headers: authHeader(),
    });
    const { events } = JSON.parse(pendingRes.payload) as { events: Array<{ source: string }> };
    expect(events[0]!.source).toBe('github');
  });

  it('rejects webhook with invalid HMAC signature', async () => {
    const app = buildServer(makeConfig({ signingSecrets: { [TEST_TOKEN]: TEST_SECRET } }));

    const res = await app.inject({
      method: 'POST',
      url: `/webhook/${TEST_TOKEN}`,
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': 'sha256=badsignature',
      },
      payload: JSON.stringify({ action: 'opened' }),
    });
    expect(res.statusCode).toBe(401);

    // Nothing written to DB
    const db = getDb();
    const rows = await db.select().from(webhookEvents);
    expect(rows).toHaveLength(0);
  });

  it('rejects webhook when signature header is missing but secret is configured', async () => {
    const app = buildServer(makeConfig({ signingSecrets: { [TEST_TOKEN]: TEST_SECRET } }));

    const res = await app.inject({
      method: 'POST',
      url: `/webhook/${TEST_TOKEN}`,
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ action: 'opened' }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts webhook without signature when no secret configured for that token', async () => {
    const app = buildServer(makeConfig({ signingSecrets: { wh_other: TEST_SECRET } }));

    const res = await app.inject({
      method: 'POST',
      url: `/webhook/${TEST_TOKEN}`,
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ hello: 'world' }),
    });
    expect(res.statusCode).toBe(202);
  });
});

describe('Management API auth', () => {
  it('returns 401 for /api/events/pending without Bearer token', async () => {
    const app = buildServer(makeConfig());
    const res = await app.inject({ method: 'GET', url: '/api/events/pending' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for wrong Bearer token', async () => {
    const app = buildServer(makeConfig());
    const res = await app.inject({
      method: 'GET',
      url: '/api/events/pending',
      headers: { Authorization: 'Bearer wrong_key' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 for /api/health with correct Bearer token', async () => {
    const app = buildServer(makeConfig());
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { ok: boolean; ts: number };
    expect(body.ok).toBe(true);
    expect(body.ts).toBeGreaterThan(0);
  });
});

describe('Multiple webhooks ordering', () => {
  it('pending events are returned oldest-first', async () => {
    const db = getDb();
    await db.insert(webhookEvents).values([
      { id: 'evt_newer', token: 'wh_a', payload: '{}', status: 'pending', createdAt: 2000 },
      { id: 'evt_older', token: 'wh_b', payload: '{}', status: 'pending', createdAt: 1000 },
    ]);

    const app = buildServer(makeConfig());
    const res = await app.inject({
      method: 'GET',
      url: '/api/events/pending',
      headers: authHeader(),
    });
    const { events } = JSON.parse(res.payload) as { events: Array<{ id: string }> };
    expect(events[0]!.id).toBe('evt_older');
    expect(events[1]!.id).toBe('evt_newer');
  });

  it('acking one event does not affect others', async () => {
    const app = buildServer(makeConfig());

    for (const action of ['opened', 'closed', 'reopened']) {
      await app.inject({
        method: 'POST',
        url: `/webhook/${TEST_TOKEN}`,
        headers: { 'Content-Type': 'application/json' },
        payload: JSON.stringify({ action }),
      });
    }

    const pendingRes = await app.inject({
      method: 'GET',
      url: '/api/events/pending',
      headers: authHeader(),
    });
    const { events } = JSON.parse(pendingRes.payload) as { events: Array<{ id: string }> };
    expect(events).toHaveLength(3);

    // Ack just the first
    await app.inject({
      method: 'POST',
      url: `/api/events/${events[0]!.id}/ack`,
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      payload: JSON.stringify({}),
    });

    const afterRes = await app.inject({
      method: 'GET',
      url: '/api/events/pending',
      headers: authHeader(),
    });
    const afterBody = JSON.parse(afterRes.payload) as { events: Array<{ id: string }> };
    expect(afterBody.events).toHaveLength(2);
  });
});
