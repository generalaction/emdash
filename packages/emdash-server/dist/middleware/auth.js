import fp from 'fastify-plugin';
const bearerAuthPlugin = async (fastify, opts) => {
    fastify.addHook('preHandler', async (request, reply) => {
        const auth = request.headers.authorization;
        if (!auth || !auth.startsWith('Bearer ') || auth.slice(7) !== opts.apiKey) {
            return reply.code(401).send({ error: 'unauthorized' });
        }
    });
};
export default fp(bearerAuthPlugin);
