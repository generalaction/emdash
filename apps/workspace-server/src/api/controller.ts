import crypto from 'node:crypto';
import {
  negotiateProtocol,
  PROTOCOL_VERSION,
  workspaceWireContract,
} from '@emdash/core/workspace-server';
import { err, ok } from '@emdash/shared';
import { createController } from '@emdash/wire';

export type WorkspaceWireControllerDeps = {
  appVersion?: string;
  daemonId?: string;
  startedAt?: number;
};

const defaultStartedAt = Date.now();
const defaultDaemonId = crypto.randomUUID();

export function createWorkspaceWireController(deps: WorkspaceWireControllerDeps = {}) {
  const appVersion = deps.appVersion ?? '0.0.0';
  const daemonId = deps.daemonId ?? defaultDaemonId;
  const startedAt = deps.startedAt ?? defaultStartedAt;

  return createController(workspaceWireContract, {
    health: () => ({
      status: 'ok' as const,
      version: appVersion,
      uptimeMs: Date.now() - startedAt,
      protocolVersion: PROTOCOL_VERSION,
    }),
    initialize: ({ protocolVersion }) => {
      const result = negotiateProtocol(protocolVersion, PROTOCOL_VERSION);
      if (!result.compatible) {
        return err({
          code: 'protocol-incompatible' as const,
          action: result.action,
          clientProtocolVersion: result.clientProtocolVersion,
          serverProtocolVersion: result.serverProtocolVersion,
        });
      }
      return ok({
        protocolVersion: PROTOCOL_VERSION,
        agreedVersion: result.agreedVersion,
        agreedMinor: result.agreedMinor,
        server: {
          appVersion,
          daemonId,
          startedAt,
        },
      });
    },
  });
}

