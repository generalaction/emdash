import crypto from 'node:crypto';
import type { WorkspaceContract } from '@emdash/core/runtimes/workspace/api';
import { workspaceJobError } from '@emdash/core/runtimes/workspace/node';
import type { HostDependenciesContract } from '@emdash/core/services/host-dependencies/api';
import {
  negotiateProtocol,
  PROTOCOL_VERSION,
  workspaceWireContract,
} from '@emdash/core/workspace-server';
import { err, ok } from '@emdash/shared';
import {
  createController,
  LiveLog,
  type ContractImpl,
  type LiveModelDef,
  type LiveModelProvider,
} from '@emdash/wire';
import type { ContractClient } from '@emdash/wire/api';
import type { WorkspaceAcpRuntimeClient } from '../acp/host';

export type WorkspaceWireControllerDeps = {
  appVersion?: string;
  daemonId?: string;
  startedAt?: number;
  acp?: WorkspaceAcpRuntimeClient;
  hostDependencies?: ContractClient<HostDependenciesContract>;
  workspace?: ContractClient<WorkspaceContract>;
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
      inspectPath: ({ path }) => ({
        kind: 'inspect-failed' as const,
        path,
        message: notImplementedMessage,
      }),
      ensureRepository: ({ path }) =>
        err({ type: 'inspect-failed' as const, path, message: notImplementedMessage }),
      cloneRepository: unavailableGitJob(),
      repository: {
        model: unavailableLiveModel(workspaceWireContract.git.repository.model),
        listWorktrees: unavailableGitResult,
        getDefaultBranch: unavailableGitResult,
        readBlobAtRef: unavailableGitResult,
        fetch: unavailableGitJob(),
        publishBranch: unavailableGitJob(),
        fetchPrForReview: unavailableGitJob(),
      },
      checkout: {
        model: unavailableLiveModel(workspaceWireContract.git.checkout.model),
        content: unavailableLiveModel(workspaceWireContract.git.checkout.content),
        fileDiff: unavailableLiveModel(workspaceWireContract.git.checkout.fileDiff),
        getFileDiff: unavailableGitResult,
        getChangedFiles: unavailableGitResult,
        getConflictVersions: unavailableGitResult,
        getFileAtRef: unavailableGitResult,
        getFileAtIndex: unavailableGitResult,
        getImageAtRef: unavailableGitResult,
        getImageAtIndex: unavailableGitResult,
        getLog: unavailableGitResult,
        getCommit: unavailableGitResult,
        getCommitFiles: unavailableGitResult,
        blame: unavailableGitResult,
        push: unavailableGitJob(),
        pull: unavailableGitJob(),
        sync: unavailableGitJob(),
      },
    },
    files: {
      fs: {
        glob: {
          run: async (input) =>
            err({ type: 'io' as const, path: input.options.cwd, message: notImplementedMessage }),
        },
        enumerate: {
          run: async (input) =>
            err({ type: 'io' as const, path: input.relative, message: notImplementedMessage }),
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
    hostDependencies: deps.hostDependencies
      ? createHostDependenciesProxy(deps.hostDependencies)
      : unavailableHostDependencies(),
    workspace: deps.workspace ? createWorkspaceProxy(deps.workspace) : unavailableWorkspace(),
  });
}

const unavailableGitResult = () =>
  err({ type: 'git_error' as const, message: notImplementedMessage });

function unavailableGitJob() {
  return {
    run: async () => unavailableGitResult(),
    toError: () => ({ type: 'git_error' as const, message: notImplementedMessage }),
  };
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

function createHostDependenciesProxy(
  client: ContractClient<HostDependenciesContract>
): NonNullable<ContractImpl<typeof workspaceWireContract>['hostDependencies']> {
  return {
    resolver: {
      resolve: (input, meta) => client.resolver.resolve(input, meta),
    },
    snapshot: client.snapshot,
    runUpdateCommand: client.runUpdateCommand,
  };
}

function unavailableHostDependencies(): NonNullable<
  ContractImpl<typeof workspaceWireContract>['hostDependencies']
> {
  const unavailable = () => err({ type: 'io' as const, message: notImplementedMessage });
  return {
    resolver: {
      resolve: unavailable,
    },
    snapshot: unavailableLiveModel(workspaceWireContract.hostDependencies.snapshot),
    runUpdateCommand: {
      run: async () => err({ type: 'io' as const, message: notImplementedMessage }),
      toError: (error) => ({
        type: 'command-failed' as const,
        message: error instanceof Error ? error.message : String(error),
        output: '',
      }),
    },
  };
}

function unavailableAcp(): NonNullable<ContractImpl<typeof workspaceWireContract>['acp']> {
  const unavailable = (): never => {
    throw new Error('ACP runtime is not available.');
  };
  return {
    startSession: unavailable,
    resumeSession: unavailable,
    stopSession: unavailable,
    sendPrompt: unavailable,
    queuePrompt: unavailable,
    editQueuedPrompt: unavailable,
    deleteQueuedPrompt: unavailable,
    changeQueuePromptOrder: unavailable,
    cancelTurn: unavailable,
    setModelOption: unavailable,
    setModeOption: unavailable,
    resolvePermission: unavailable,
    setPromptDraft: unavailable,
    exportACPTranscript: unavailable,
    exportRawAcpLog: unavailable,
    uploadAttachment: unavailable,
    downloadAttachment: unavailable,
    deleteAttachment: unavailable,
    getHistory: unavailable,
    sessions: unavailableLiveModel(workspaceWireContract.acp.sessions),
    session: unavailableLiveModel(workspaceWireContract.acp.session),
    terminalOutput: () => null,
  };
}

function createWorkspaceProxy(
  client: ContractClient<WorkspaceContract>
): NonNullable<ContractImpl<typeof workspaceWireContract>['workspace']> {
  return {
    workspace: client.workspace,
    reconcile: (input, meta) => client.reconcile(input, meta),
    provision: client.provision,
    convert: client.convert,
    activate: client.activate,
    deactivate: client.deactivate,
    teardown: client.teardown,
    runScript: client.runScript,
    scriptOutput: (key) => client.scriptOutput.handle(key).asLiveSource(),
  };
}

function unavailableWorkspace(): NonNullable<
  ContractImpl<typeof workspaceWireContract>['workspace']
> {
  const unavailable = () =>
    err({ type: 'runtime-unavailable' as const, message: notImplementedMessage });
  return {
    workspace: unavailableLiveModel(workspaceWireContract.workspace.workspace),
    reconcile: unavailable,
    provision: {
      run: async () =>
        err({ type: 'runtime-unavailable' as const, message: notImplementedMessage }),
      toError: workspaceJobError,
    },
    convert: {
      run: async () =>
        err({ type: 'runtime-unavailable' as const, message: notImplementedMessage }),
      toError: workspaceJobError,
    },
    activate: {
      run: async () =>
        err({ type: 'runtime-unavailable' as const, message: notImplementedMessage }),
      toError: workspaceJobError,
    },
    deactivate: {
      run: async () =>
        err({ type: 'runtime-unavailable' as const, message: notImplementedMessage }),
      toError: workspaceJobError,
    },
    teardown: {
      run: async () =>
        err({ type: 'runtime-unavailable' as const, message: notImplementedMessage }),
      toError: workspaceJobError,
    },
    runScript: {
      run: async () =>
        err({ type: 'runtime-unavailable' as const, message: notImplementedMessage }),
      toError: workspaceJobError,
    },
    scriptOutput: () => new LiveLog(),
  };
}
