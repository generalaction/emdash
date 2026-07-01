import crypto from 'node:crypto';
import { implement } from '@orpc/server';
import { PROTOCOL_VERSION, negotiateProtocol, workspaceContract } from '@emdash/core/workspace-server';

const i = implement(workspaceContract);

const startedAt = Date.now();
const daemonId = crypto.randomUUID();

export const router = i.router({
  health: i.health.handler(() => ({
    status: 'ok' as const,
    version: process.env['npm_package_version'] ?? '0.0.0',
    uptimeMs: Date.now() - startedAt,
  })),

  initialize: i.initialize.handler(({ input, errors }) => {
    const result = negotiateProtocol(input.protocolVersion, PROTOCOL_VERSION);
    if (!result.compatible) {
      throw errors.PROTOCOL_INCOMPATIBLE({
        data: {
          action: result.action,
          clientProtocolVersion: result.clientProtocolVersion,
          serverProtocolVersion: result.serverProtocolVersion,
        },
      });
    }
    return {
      protocolVersion: PROTOCOL_VERSION,
      agreedVersion: result.agreedVersion,
      agreedMinor: result.agreedMinor,
      server: {
        appVersion: process.env['npm_package_version'] ?? '0.0.0',
        daemonId,
        startedAt,
      },
    };
  }),
});
