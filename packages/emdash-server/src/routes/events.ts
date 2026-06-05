import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../db/client.js';
import { webhookEvents } from '../db/schema.js';

export const eventsPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/events/pending', async (_request, reply) => {
    const db = getDb();
    const events = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.status, 'pending'))
      .orderBy(asc(webhookEvents.createdAt))
      .limit(100);
    return reply.send({ events });
  });

  fastify.post<{ Params: { id: string }; Body: { error?: string } }>(
    '/api/events/:id/ack',
    async (request, reply) => {
      const { id } = request.params;
      const { error } = (request.body as { error?: string }) ?? {};
      const db = getDb();
      const result = await db
        .update(webhookEvents)
        .set({
          status: error ? 'failed' : 'processed',
          error: error ?? null,
          processedAt: Date.now(),
        })
        .where(and(eq(webhookEvents.id, id), eq(webhookEvents.status, 'pending')))
        .returning({ id: webhookEvents.id });
      if (result.length === 0) {
        return reply.code(404).send({ error: 'event_not_found' });
      }
      return reply.send({ ok: true });
    }
  );

  fastify.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/api/events',
    async (request, reply) => {
      const limit = Math.min(Number(request.query.limit ?? 50), 200);
      const offset = Number(request.query.offset ?? 0);
      const db = getDb();
      const events = await db
        .select()
        .from(webhookEvents)
        .orderBy(desc(webhookEvents.createdAt))
        .limit(limit)
        .offset(offset);
      return reply.send({ events });
    }
  );
};
