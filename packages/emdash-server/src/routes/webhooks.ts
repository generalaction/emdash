import type { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';
import { getDb } from '../db/client.js';
import { webhookEvents } from '../db/schema.js';
import { verifyGithubSignature } from '../crypto.js';

type WebhooksOptions = {
  signingSecrets?: Record<string, string>;
};

export const webhooksPlugin: FastifyPluginAsync<WebhooksOptions> = async (fastify, opts) => {
  const signingSecrets = opts.signingSecrets ?? {};

  // Capture raw body bytes before Fastify parses JSON so HMAC verification
  // works correctly (GitHub signs the original bytes, not re-serialized JSON).
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        done(null, { parsed: JSON.parse(body as string), raw: body as string });
      } catch (err) {
        done(err as Error);
      }
    }
  );

  fastify.post<{ Params: { token: string } }>('/webhook/:token', async (request, reply) => {
    const { token } = request.params;
    const { parsed, raw } = request.body as { parsed: unknown; raw: string };
    const rawBody = raw;

    const signingSecret = signingSecrets[token];
    if (signingSecret) {
      const signature = request.headers['x-hub-signature-256'] as string | undefined;
      if (!verifyGithubSignature(signingSecret, rawBody, signature)) {
        return reply.code(401).send({ error: 'invalid_signature' });
      }
    }

    const source = detectSource(request.headers as Record<string, string | string[] | undefined>);
    const db = getDb();
    await db.insert(webhookEvents).values({
      id: nanoid(),
      token,
      source,
      payload: JSON.stringify(parsed),
      headers: JSON.stringify(relevantHeaders(request.headers as Record<string, string | string[] | undefined>)),
      status: 'pending',
      createdAt: Date.now(),
    });

    return reply.code(202).send({ ok: true });
  });
};

function detectSource(headers: Record<string, string | string[] | undefined>): string {
  if (headers['x-github-event']) return 'github';
  if (headers['linear-event']) return 'linear';
  return 'generic';
}

function relevantHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const keys = ['x-github-event', 'x-github-delivery', 'linear-event', 'x-hub-signature-256'];
  const result: Record<string, string> = {};
  for (const key of keys) {
    const val = headers[key];
    if (val) result[key] = Array.isArray(val) ? val[0]! : val;
  }
  return result;
}
