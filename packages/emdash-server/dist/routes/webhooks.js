import { nanoid } from 'nanoid';
import { getDb } from '../db/client.js';
import { webhookEvents } from '../db/schema.js';
import { verifyGithubSignature } from '../crypto.js';
export const webhooksPlugin = async (fastify, opts) => {
    const signingSecrets = opts.signingSecrets ?? {};
    fastify.post('/webhook/:token', async (request, reply) => {
        const { token } = request.params;
        const rawBody = JSON.stringify(request.body);
        const signingSecret = signingSecrets[token];
        if (signingSecret) {
            const signature = request.headers['x-hub-signature-256'];
            if (!verifyGithubSignature(signingSecret, rawBody, signature)) {
                return reply.code(401).send({ error: 'invalid_signature' });
            }
        }
        const source = detectSource(request.headers);
        const db = getDb();
        await db.insert(webhookEvents).values({
            id: nanoid(),
            token,
            source,
            payload: rawBody,
            headers: JSON.stringify(relevantHeaders(request.headers)),
            status: 'pending',
            createdAt: Date.now(),
        });
        return reply.code(202).send({ ok: true });
    });
};
function detectSource(headers) {
    if (headers['x-github-event'])
        return 'github';
    if (headers['linear-event'])
        return 'linear';
    return 'generic';
}
function relevantHeaders(headers) {
    const keys = ['x-github-event', 'x-github-delivery', 'linear-event', 'x-hub-signature-256'];
    const result = {};
    for (const key of keys) {
        const val = headers[key];
        if (val)
            result[key] = Array.isArray(val) ? val[0] : val;
    }
    return result;
}
