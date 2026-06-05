import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { webhooksPlugin } from './webhooks.js';
import { initDb, getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { webhookEvents } from '../db/schema.js';

function buildApp(opts?: { signingSecrets?: Record<string, string> }) {
  const app = Fastify();
  app.register(webhooksPlugin, opts ?? {});
  return app;
}

beforeEach(() => {
  initDb(':memory:');
  runMigrations();
});

describe('POST /webhook/:token', () => {
  it('returns 202 for valid request with no signing secret', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/wh_testtoken',
      payload: { action: 'opened' },
    });
    expect(res.statusCode).toBe(202);
  });

  it('writes a pending event to the DB', async () => {
    const app = buildApp();
    await app.inject({
      method: 'POST',
      url: '/webhook/wh_testtoken',
      payload: { ref: 'main' },
    });
    const db = getDb();
    const events = await db.select().from(webhookEvents);
    expect(events).toHaveLength(1);
    expect(events[0]!.token).toBe('wh_testtoken');
    expect(events[0]!.status).toBe('pending');
  });

  it('returns 401 when HMAC signature is required but missing', async () => {
    const app = buildApp({ signingSecrets: { wh_securetoken: 'mysecret' } });
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/wh_securetoken',
      payload: { action: 'opened' },
    });
    expect(res.statusCode).toBe(401);
  });
});
