import crypto from 'node:crypto';
import {
  negotiateProtocol,
  PROTOCOL_VERSION,
  workspaceWireContract,
} from '@emdash/core/workspace-server';
import { err, ok } from '@emdash/shared';
import { createController, type LiveModelDef, type LiveModelProvider } from '@emdash/wire';

export type WorkspaceWireControllerDeps = {
  appVersion?: string;
  daemonId?: string;
  startedAt?: number;
};

const defaultStartedAt = Date.now();
const defaultDaemonId = crypto.randomUUID();
const notImplementedMessage = 'Workspace domain is not implemented yet.';

export function createWorkspaceWireController(deps: WorkspaceWireControllerDeps = {}) {
  const appVersion = deps.appVersion ?? process.env['npm_package_version'] ?? '0.0.0';
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
    git: {
      repository: {
        model: unavailableLiveModel(workspaceWireContract.git.repository.model),
      },
      checkout: {
        model: unavailableLiveModel(workspaceWireContract.git.checkout.model),
        fileDiff: unavailableLiveModel(workspaceWireContract.git.checkout.fileDiff),
      },
    },
    files: {
      fs: {
        glob: {
          run: async (input) =>
            err({ type: 'io' as const, path: input.rootPath, message: notImplementedMessage }),
        },
        enumerate: {
          run: async (input) =>
            err({ type: 'io' as const, path: input.path, message: notImplementedMessage }),
        },
      },
      tree: {
        model: unavailableLiveModel(workspaceWireContract.files.tree.model),
      },
      content: unavailableLiveModel(workspaceWireContract.files.content),
    },
    ptyAgent: {
      output: () => null,
      sessions: unavailableLiveModel(workspaceWireContract.ptyAgent.sessions),
    },
  });
}

function unavailableLiveModel<Group extends LiveModelDef>(contract: Group): LiveModelProvider<Group> {
  return {
    kind: 'liveModelProvider',
    contract,
    resolveState: () => null,
    async runMutation() {
      throw new Error(notImplementedMessage);
    },
  };
}
