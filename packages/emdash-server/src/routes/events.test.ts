import { and, eq } from 'drizzle-orm';
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { eventsPlugin } from './events.js';
import { initDb, getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { webhookEvents } from '../db/schema.js';

function buildApp() {
  const app = Fastify();
  app.register(eventsPlugin);
  return app;
}

beforeEach(() => {
  initDb(':memory:');
  runMigrations();
});

describe('GET /api/events/pending', () => {
  it('returns empty list when no events', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/events/pending' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).events).toEqual([]);
  });

  it('returns only pending events', async () => {
    const db = getDb();
    await db.insert(webhookEvents).values([
      { id: 'evt1', token: 'wh_a', payload: '{}', status: 'pending', createdAt: 1000 },
      { id: 'evt2', token: 'wh_b', payload: '{}', status: 'processed', createdAt: 1001 },
    ]);
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/events/pending' });
    const body = JSON.parse(res.payload) as { events: Array<{ id: string }> };
    expect(body.events).toHaveLength(1);
    expect(body.events[0]!.id).toBe('evt1');
  });
});

describe('POST /api/events/:id/ack', () => {
  it('marks event as processed', async () => {
    const db = getDb();
    await db.insert(webhookEvents).values({ id: 'evt1', token: 'wh_a', payload: '{}', status: 'pending', createdAt: 1000 });
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/events/evt1/ack', payload: {} });
    expect(res.statusCode).toBe(200);
    const updated = await db.select().from(webhookEvents).where(eq(webhookEvents.id, 'evt1'));
    expect(updated[0]!.status).toBe('processed');
  });

  it('marks event as failed when error provided', async () => {
    const db = getDb();
    await db.insert(webhookEvents).values({ id: 'evt1', token: 'wh_a', payload: '{}', status: 'pending', createdAt: 1000 });
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/events/evt1/ack', payload: { error: 'no_project' } });
    expect(res.statusCode).toBe(200);
    const updated = await db.select().from(webhookEvents);
    expect(updated[0]!.status).toBe('failed');
    expect(updated[0]!.error).toBe('no_project');
  });

  it('returns 404 for unknown event', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/events/nope/ack', payload: {} });
    expect(res.statusCode).toBe(404);
  });
});
