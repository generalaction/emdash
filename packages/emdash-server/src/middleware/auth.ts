import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

const bearerAuthPlugin: FastifyPluginAsync<{ apiKey: string }> = async (fastify, opts) => {
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ') || auth.slice(7) !== opts.apiKey) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });
};

export default fp(bearerAuthPlugin);
