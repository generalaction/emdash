import crypto from 'node:crypto';
import {
  negotiateProtocol,
  PROTOCOL_VERSION,
  workspaceWireContract,
} from '@emdash/core/workspace-server';
import { err, ok } from '@emdash/shared';
import {
  createController,
  type ContractImpl,
  type LiveModelDef,
  type LiveModelProvider,
} from '@emdash/wire';
import type { WorkspaceAcpRuntimeClient } from '../acp/host';

export type WorkspaceWireControllerDeps = {
  appVersion?: string;
  daemonId?: string;
  startedAt?: number;
  acp?: WorkspaceAcpRuntimeClient;
};

const defaultStartedAt = Date.now();
const defaultDaemonId = crypto.randomUUID();
const notImplementedMessage = 'Workspace domain is not implemented yet.';

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
    agentConfig: unavailableAgentConfig(),
    tuiAgents: unavailableTuiAgents(),
    acp: deps.acp ? createAcpProxy(deps.acp) : unavailableAcp(),
  });
}

function unavailableLiveModel<Group extends LiveModelDef>(
  contract: Group
): LiveModelProvider<Group> {
  return {
    kind: 'liveModelProvider',
    contract,
    resolveState: () => null,
    async runMutation() {
      throw new Error(notImplementedMessage);
    },
  };
}

function createAcpProxy(
  client: WorkspaceAcpRuntimeClient
): NonNullable<ContractImpl<typeof workspaceWireContract>['acp']> {
  return {
    startSession: (input, meta) => client.startSession(input, meta),
    resumeSession: (input, meta) => client.resumeSession(input, meta),
    stopSession: (input, meta) => client.stopSession(input, meta),
    sendPrompt: (input, meta) => client.sendPrompt(input, meta),
    queuePrompt: (input, meta) => client.queuePrompt(input, meta),
    editQueuedPrompt: (input, meta) => client.editQueuedPrompt(input, meta),
    deleteQueuedPrompt: (input, meta) => client.deleteQueuedPrompt(input, meta),
    changeQueuePromptOrder: (input, meta) => client.changeQueuePromptOrder(input, meta),
    cancelTurn: (input, meta) => client.cancelTurn(input, meta),
    setModelOption: (input, meta) => client.setModelOption(input, meta),
    setModeOption: (input, meta) => client.setModeOption(input, meta),
    resolvePermission: (input, meta) => client.resolvePermission(input, meta),
    setPromptDraft: (input, meta) => client.setPromptDraft(input, meta),
    exportACPTranscript: (input, meta) => client.exportACPTranscript(input, meta),
    exportRawAcpLog: (input, meta) => client.exportRawAcpLog(input, meta),
    uploadAttachment: (input, file, meta) => client.uploadAttachment(input, file, meta),
    downloadAttachment: async (input, meta) => {
      const result = await client.downloadAttachment(input, meta);
      if (!result.success) return result;
      return ok({ meta: result.data.meta, source: result.data.chunks() });
    },
    deleteAttachment: (input, meta) => client.deleteAttachment(input, meta),
    getHistory: (input, meta) => client.getHistory(input, meta),
    sessions: client.sessions,
    session: client.session,
    terminalOutput: client.terminalOutput,
  };
}

function unavailableTuiAgents(): NonNullable<
  ContractImpl<typeof workspaceWireContract>['tuiAgents']
> {
  const unavailable = () =>
    err({ type: 'runtime-unavailable' as const, message: notImplementedMessage });

  return {
    startSession: unavailable,
    resumeSession: unavailable,
    stopSession: unavailable,
    deleteSession: unavailable,
    sendInput: unavailable,
    resize: unavailable,
    emitHookEvent: unavailable,
    output: () => null,
    sessions: unavailableLiveModel(workspaceWireContract.tuiAgents.sessions),
    notifications: unavailableLiveModel(workspaceWireContract.tuiAgents.notifications),
  };
}

function unavailableAgentConfig(): NonNullable<
  ContractImpl<typeof workspaceWireContract>['agentConfig']
> {
  const unavailable = () =>
    err({ type: 'runtime-unavailable' as const, message: notImplementedMessage });
  return {
    agents: unavailableLiveModel(workspaceWireContract.agentConfig.agents),
    refreshAgents: unavailable,
    installAgent: {
      run: async () =>
        err({ type: 'runtime-unavailable' as const, message: notImplementedMessage }),
      toError: (error) => ({
        type: 'command-failed' as const,
        message: error instanceof Error ? error.message : String(error),
        output: '',
      }),
    },
    uninstallAgent: unavailable,
    startLogin: unavailable,
    cancelLogin: unavailable,
    sendLoginInput: unavailable,
    resizeLogin: unavailable,
    markUrlHandled: unavailable,
    refreshAuthStatus: unavailable,
    loginOutput: () => null,
    mcpServers: unavailableLiveModel(workspaceWireContract.agentConfig.mcpServers),
    saveMcpServer: unavailable,
    removeMcpServer: unavailable,
    listMcpForAgent: unavailable,
    skills: unavailableLiveModel(workspaceWireContract.agentConfig.skills),
    installSkill: unavailable,
    removeSkill: unavailable,
    createSkill: unavailable,
  };
}

function unavailableAcp(): NonNullable<ContractImpl<typeof workspaceWireContract>['acp']> {
  return {
    sessions: unavailableLiveModel(workspaceWireContract.acp.sessions),
    session: unavailableLiveModel(workspaceWireContract.acp.session),
    terminalOutput: () => null,
  };
}
