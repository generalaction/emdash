import type { FastifyPluginAsync } from 'fastify';

export const healthPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/health', async (_request, reply) => {
    return reply.send({ ok: true, ts: Date.now() });
  });
};
