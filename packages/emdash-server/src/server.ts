import Fastify, { type FastifyInstance } from 'fastify';
import bearerAuthPlugin from './middleware/auth.js';
import { healthPlugin } from './routes/health.js';
import { webhooksPlugin } from './routes/webhooks.js';
import { eventsPlugin } from './routes/events.js';
import type { Config } from './config.js';

export function buildServer(config: Config): FastifyInstance {
  const app = Fastify({ logger: false });

  // Webhook routes — no auth, HMAC-verified per token
  app.register(webhooksPlugin, { signingSecrets: config.signingSecrets });

  // Management routes — Bearer auth required
  app.register(async (protected_) => {
    await protected_.register(bearerAuthPlugin, { apiKey: config.apiKey });
    protected_.register(healthPlugin);
    protected_.register(eventsPlugin);
  });

  return app;
}
