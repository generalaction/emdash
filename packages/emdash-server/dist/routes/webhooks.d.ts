import type { FastifyPluginAsync } from 'fastify';
type WebhooksOptions = {
    signingSecrets?: Record<string, string>;
};
export declare const webhooksPlugin: FastifyPluginAsync<WebhooksOptions>;
export {};
