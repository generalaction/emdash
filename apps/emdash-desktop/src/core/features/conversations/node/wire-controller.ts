import { LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import { err, type PendingLease, type Result } from '@emdash/shared';
import type { LeasedLiveModelProvider, LiveSource } from '@emdash/wire';
import {
  createController,
  type CallMeta,
  type Controller,
  type LiveModelDef,
} from '@emdash/wire/api';
import { and, eq } from 'drizzle-orm';
import type { AppDb } from '@core/services/app-db/node/db';
import { conversations, tasks } from '@core/services/app-db/node/schema';
import { conversationOperations } from '@main/core/conversations/controller';
import { setConversationModeId } from '@main/core/conversations/set-mode-id';
import { setSessionId } from '@main/core/conversations/set-session-id';
import { touchConversation } from '@main/core/conversations/touchConversation';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { conversationsContract } from '../api';
import {
  throwConversationsRuntimeResolveError,
  type ConversationsAcpStartInput,
  type ConversationsHostRuntimesClient,
  type ConversationsRuntimeBroker,
  type ConversationsRuntimeResolveError as RuntimeResolveError,
} from '../api/runtime-adapter';
import { conversationWireEvents } from './event-host';

type ConversationRuntimeTarget = Readonly<{
  conversationId: string;
  projectId: string;
  taskId: string;
  providerId: string | null;
  sessionId: string | null;
  modeId: string | null;
  workspacePath?: string;
  host: HostRef;
  acpInput?: ConversationsAcpStartInput;
}>;

type WorkspaceIdentityResolver = Readonly<{
  resolve(workspaceId: string): Promise<{ host: HostRef; path: string } | null>;
}>;

type ConversationRuntimeHooks = Readonly<{
  persistAcpSessionId(target: ConversationRuntimeTarget, sessionId: string): Promise<void>;
  persistAcpMode(target: ConversationRuntimeTarget, modeId: string): Promise<void>;
  recordTuiInput(target: ConversationRuntimeTarget): Promise<void>;
}>;

export type CreateConversationsWireControllerOptions = Readonly<{
  db: AppDb;
  runtimes: ConversationsRuntimeBroker;
  workspaceIdentity: WorkspaceIdentityResolver;
  resolveTarget?: (conversationId: string) => Promise<ConversationRuntimeTarget>;
  hooks?: ConversationRuntimeHooks;
}>;

export function createConversationsWireController(
  options: CreateConversationsWireControllerOptions
): Controller {
  const resolveTarget =
    options.resolveTarget ??
    ((conversationId) =>
      resolveConversationRuntimeTarget(conversationId, options.workspaceIdentity, options.db));
  const hooks = options.hooks ?? createDefaultRuntimeHooks(options.db);
  const target = (conversationId: string) => resolveTarget(conversationId);
  const run = <T, E>(
    conversationId: string,
    work: (
      client: ConversationsHostRuntimesClient,
      target: ConversationRuntimeTarget
    ) => Promise<Result<T, E>>
  ) => withConversationRuntime(options.runtimes, target(conversationId), work);

  const acpSessions = leasedModelProvider(conversationsContract.acp.sessions, (key, name) =>
    acquireRuntimeSource(options.runtimes, Promise.resolve(LOCAL_HOST_REF), (client) =>
      client.acp.sessions.state(key, name).asLiveSource()
    )
  );
  const acpSession = leasedModelProvider(conversationsContract.acp.session, (key, name) =>
    acquireConversationRuntimeSource(options.runtimes, target(key.conversationId), (client) =>
      client.acp.session.state(key, name).asLiveSource()
    )
  );
  const tuiSessions = leasedModelProvider(conversationsContract.tui.sessions, (key, name) =>
    acquireRuntimeSource(options.runtimes, Promise.resolve(LOCAL_HOST_REF), (client) =>
      client.tuiAgents.sessions.state(key, name).asLiveSource()
    )
  );

  return createController(conversationsContract, {
    getConversations: () => conversationOperations.getConversations(),
    createConversation: (input) => conversationOperations.createConversation(input),
    deleteConversation: ({ projectId, taskId, conversationId }) =>
      conversationOperations.deleteConversation(projectId, taskId, conversationId),
    hydrateConversation: ({ projectId, taskId, conversationId }) =>
      conversationOperations.hydrateConversation(projectId, taskId, conversationId),
    dehydrateConversation: ({ projectId, taskId, conversationId }) =>
      conversationOperations.dehydrateConversation(projectId, taskId, conversationId),
    renameConversation: ({ conversationId, name }) =>
      conversationOperations.renameConversation(conversationId, name),
    getConversationsForTask: ({ projectId, taskId }) =>
      conversationOperations.getConversationsForTask(projectId, taskId),
    getConversationsForProject: ({ projectId }) =>
      conversationOperations.getConversationsForProject(projectId),
    markConversationSeen: ({ conversationId }) =>
      conversationOperations.markConversationSeen(conversationId),
    events: conversationWireEvents,
    acp: {
      startSession: async ({ conversationId }, meta) => {
        const runtimeTarget = await target(conversationId);
        if (!runtimeTarget.acpInput) {
          throw new Error(`Conversation '${conversationId}' is not an ACP conversation`);
        }
        const input = runtimeTarget.acpInput;
        return withConversationRuntime(
          options.runtimes,
          Promise.resolve(runtimeTarget),
          async (client) => {
            const result = await client.acp.startSession({ input }, callOptions(meta));
            if (result.success) {
              await hooks.persistAcpSessionId(runtimeTarget, result.data.sessionId);
            }
            return result;
          }
        );
      },
      resumeSession: async ({ conversationId }, meta) => {
        const runtimeTarget = await target(conversationId);
        const input = runtimeTarget.acpInput;
        if (!input) {
          throw new Error(`Conversation '${conversationId}' is not an ACP conversation`);
        }
        if (!input.sessionId) {
          throw new Error(`Conversation '${conversationId}' has no ACP session to resume`);
        }
        const sessionId = input.sessionId;
        return withConversationRuntime(
          options.runtimes,
          Promise.resolve(runtimeTarget),
          async (client) => {
            const result = await client.acp.resumeSession(
              { input: { ...input, sessionId } },
              callOptions(meta)
            );
            if (result.success) {
              await hooks.persistAcpSessionId(runtimeTarget, result.data.sessionId);
            }
            return result;
          }
        );
      },
      stopSession: (input, meta) =>
        run(input.conversationId, (client) => client.acp.stopSession(input, callOptions(meta))),
      killSession: (input, meta) =>
        run(input.conversationId, (client) => client.acp.killSession(input, callOptions(meta))),
      sendPrompt: (input, meta) =>
        run(input.conversationId, (client) => client.acp.sendPrompt(input, callOptions(meta))),
      queuePrompt: (input, meta) =>
        run(input.conversationId, (client) => client.acp.queuePrompt(input, callOptions(meta))),
      editQueuedPrompt: (input, meta) =>
        run(input.conversationId, (client) =>
          client.acp.editQueuedPrompt(input, callOptions(meta))
        ),
      deleteQueuedPrompt: (input, meta) =>
        run(input.conversationId, (client) =>
          client.acp.deleteQueuedPrompt(input, callOptions(meta))
        ),
      changeQueuePromptOrder: (input, meta) =>
        run(input.conversationId, (client) =>
          client.acp.changeQueuePromptOrder(input, callOptions(meta))
        ),
      cancelTurn: (input, meta) =>
        run(input.conversationId, (client) => client.acp.cancelTurn(input, callOptions(meta))),
      setModelOption: (input, meta) =>
        run(input.conversationId, (client) => client.acp.setModelOption(input, callOptions(meta))),
      setModeOption: async (input, meta) => {
        const runtimeTarget = await target(input.conversationId);
        return withConversationRuntime(
          options.runtimes,
          Promise.resolve(runtimeTarget),
          async (client) => {
            const result = await client.acp.setModeOption(input, callOptions(meta));
            if (result.success) {
              await hooks.persistAcpMode(runtimeTarget, input.value);
            }
            return result;
          }
        );
      },
      resolvePermission: (input, meta) =>
        run(input.conversationId, (client) =>
          client.acp.resolvePermission(input, callOptions(meta))
        ),
      setPromptDraft: (input, meta) =>
        run(input.conversationId, (client) => client.acp.setPromptDraft(input, callOptions(meta))),
      exportACPTranscript: (input, meta) =>
        run(input.conversationId, (client) =>
          client.acp.exportACPTranscript(input, callOptions(meta))
        ),
      exportRawAcpLog: (input, meta) =>
        run(input.conversationId, (client) => client.acp.exportRawAcpLog(input, callOptions(meta))),
      uploadAttachment: ({ conversationId, originalPath }, file, meta) =>
        run(conversationId, (client) =>
          client.acp.uploadAttachment({ originalPath }, file, callOptions(meta))
        ),
      downloadAttachment: ({ conversationId, id }, meta) =>
        openAttachmentDownload(options.runtimes, target(conversationId), id, callOptions(meta)),
      deleteAttachment: ({ conversationId, id }, meta) =>
        run(conversationId, (client) => client.acp.deleteAttachment({ id }, callOptions(meta))),
      getHistory: (input, meta) =>
        run(input.conversationId, (client) => client.acp.getHistory(input, callOptions(meta))),
      sessions: acpSessions,
      session: acpSession,
      terminalOutput: ({ conversationId, terminalId }) =>
        leasedLiveSource(() =>
          acquireConversationRuntimeSource(options.runtimes, target(conversationId), (client) =>
            client.acp.terminalOutput.handle({ terminalId }).asLiveSource()
          )
        ),
    },
    tui: {
      startSession: (input, meta) =>
        run(input.input.conversationId, (client) =>
          client.tuiAgents.startSession(input, callOptions(meta))
        ),
      resumeSession: (input, meta) =>
        run(input.input.conversationId, (client) =>
          client.tuiAgents.resumeSession(input, callOptions(meta))
        ),
      stopSession: (input, meta) =>
        run(input.conversationId, (client) =>
          client.tuiAgents.stopSession(input, callOptions(meta))
        ),
      deactivateSession: (input, meta) =>
        run(input.conversationId, (client) =>
          client.tuiAgents.deactivateSession(input, callOptions(meta))
        ),
      deleteSession: (input, meta) =>
        run(input.conversationId, (client) =>
          client.tuiAgents.deleteSession(input, callOptions(meta))
        ),
      killSession: (input, meta) =>
        run(input.conversationId, (client) =>
          client.tuiAgents.killSession(input, callOptions(meta))
        ),
      sendInput: async (input, meta) => {
        const runtimeTarget = await target(input.conversationId);
        return withConversationRuntime(
          options.runtimes,
          Promise.resolve(runtimeTarget),
          async (client) => {
            const result = await client.tuiAgents.sendInput(input, callOptions(meta));
            if (result.success && input.data.includes('\r')) {
              await hooks.recordTuiInput(runtimeTarget);
            }
            return result;
          }
        );
      },
      resize: (input, meta) =>
        run(input.conversationId, (client) => client.tuiAgents.resize(input, callOptions(meta))),
      output: ({ conversationId }) =>
        leasedLiveSource(() =>
          acquireConversationRuntimeSource(options.runtimes, target(conversationId), (client) =>
            client.tuiAgents.output.handle({ conversationId }).asLiveSource()
          )
        ),
      sessions: tuiSessions,
    },
  });
}

function createDefaultRuntimeHooks(db: AppDb): ConversationRuntimeHooks {
  return {
    async persistAcpSessionId(target, sessionId) {
      const result = await setSessionId(target.conversationId, sessionId, db);
      if (!result.success) {
        log.warn('ACP runtime failed to persist returned session id', {
          conversationId: target.conversationId,
          error: result.error,
        });
        return;
      }
      if (target.sessionId === sessionId) return;
      conversationWireEvents.emit(undefined, {
        type: 'changed',
        conversationId: target.conversationId,
        taskId: result.data.taskId,
        projectId: result.data.projectId,
        changes: { sessionId },
      });
    },
    async persistAcpMode(target, modeId) {
      const result = await setConversationModeId(target.conversationId, modeId, db);
      if (!result.success) {
        log.warn('ACP runtime failed to persist selected mode id', {
          conversationId: target.conversationId,
          error: result.error,
        });
        return;
      }
      if (target.modeId === modeId) return;
      conversationWireEvents.emit(undefined, {
        type: 'changed',
        conversationId: target.conversationId,
        taskId: result.data.taskId,
        projectId: result.data.projectId,
        changes: { modeId },
      });
    },
    async recordTuiInput(target) {
      if (target.providerId) {
        telemetryService.capture('agent_run_started', {
          provider: target.providerId,
          project_id: target.projectId,
          task_id: target.taskId,
          conversation_id: target.conversationId,
        });
      }
      const lastInteractedAt = new Date().toISOString();
      await touchConversation(target.conversationId, lastInteractedAt, db);
      conversationWireEvents.emit(undefined, {
        type: 'changed',
        conversationId: target.conversationId,
        taskId: target.taskId,
        projectId: target.projectId,
        changes: { lastInteractedAt },
      });
    },
  };
}

async function resolveConversationRuntimeTarget(
  conversationId: string,
  workspaceIdentity: WorkspaceIdentityResolver,
  db: AppDb
): Promise<ConversationRuntimeTarget> {
  const [row] = await db
    .select({
      projectId: conversations.projectId,
      taskId: conversations.taskId,
      providerId: conversations.provider,
      sessionId: conversations.sessionId,
      config: conversations.config,
      type: conversations.type,
      workspaceId: tasks.workspaceId,
    })
    .from(conversations)
    .leftJoin(
      tasks,
      and(eq(tasks.id, conversations.taskId), eq(tasks.projectId, conversations.projectId))
    )
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!row) throw new Error(`Conversation '${conversationId}' was not found`);

  const identity = row.workspaceId ? await workspaceIdentity.resolve(row.workspaceId) : null;
  const acpConfig = row.config?.type === 'acp' ? row.config : undefined;
  const initialQueue =
    row.sessionId === null
      ? acpConfig?.initialQueue?.length
        ? acpConfig.initialQueue
        : acpConfig?.initialPrompt?.trim()
          ? [{ text: acpConfig.initialPrompt }]
          : undefined
      : undefined;
  const workspacePath = identity?.path;
  const acpInput =
    row.type === 'acp' && workspacePath && row.providerId
      ? {
          conversationId,
          providerId: row.providerId,
          cwd: workspacePath,
          sessionId: row.sessionId,
          model: acpConfig?.model ?? null,
          modeId: acpConfig?.modeId ?? null,
          ...(initialQueue && { initialQueue }),
        }
      : undefined;

  return {
    conversationId,
    projectId: row.projectId,
    taskId: row.taskId,
    providerId: row.providerId,
    sessionId: row.sessionId,
    modeId: acpConfig?.modeId ?? null,
    workspacePath,
    host: identity?.host ?? LOCAL_HOST_REF,
    acpInput,
  };
}

async function withConversationRuntime<T, E>(
  runtimes: ConversationsRuntimeBroker,
  targetPromise: Promise<ConversationRuntimeTarget>,
  work: (
    client: ConversationsHostRuntimesClient,
    target: ConversationRuntimeTarget
  ) => Promise<Result<T, E>>
): Promise<Result<T, E | RuntimeResolveError>> {
  const target = await targetPromise;
  const lease = runtimes.session(target.host);
  try {
    const result = await lease.ready();
    if (!result.success) return err(result.error);
    return await work(result.data, target);
  } finally {
    await lease.release();
  }
}

function callOptions(meta: CallMeta): { signal?: AbortSignal } {
  return meta.signal ? { signal: meta.signal } : {};
}

function leasedModelProvider<Group extends LiveModelDef>(
  contract: Group,
  acquireState: LeasedLiveModelProvider<Group>['acquireState']
): LeasedLiveModelProvider<Group> {
  return {
    kind: 'leasedLiveModelProvider',
    contract,
    acquireState,
    async runMutation() {
      throw new Error(`Live model '${contract.id}' has no mutations`);
    },
    async dispose() {},
  };
}

function acquireConversationRuntimeSource(
  runtimes: ConversationsRuntimeBroker,
  targetPromise: Promise<ConversationRuntimeTarget>,
  source: (client: ConversationsHostRuntimesClient) => LiveSource
): PendingLease<LiveSource> {
  return acquireRuntimeSource(
    runtimes,
    targetPromise.then((target) => target.host),
    source
  );
}

function acquireRuntimeSource(
  runtimes: ConversationsRuntimeBroker,
  hostPromise: Promise<HostRef>,
  source: (client: ConversationsHostRuntimesClient) => LiveSource
): PendingLease<LiveSource> {
  const acquired = hostPromise.then((host) => {
    const lease = runtimes.session(host);
    return { lease, ready: lease.ready() };
  });
  return {
    async ready() {
      const { ready } = await acquired;
      const result = await ready;
      if (!result.success) throwConversationsRuntimeResolveError(result.error);
      return source(result.data);
    },
    async release() {
      // If acquisition failed there is no lease to release; the failure already
      // surfaced through ready() and must not reject again here.
      const runtime = await acquired.catch(() => null);
      if (runtime) await runtime.lease.release();
    },
  };
}

function leasedLiveSource(acquire: () => PendingLease<LiveSource>): LiveSource {
  return {
    async snapshot() {
      const lease = acquire();
      try {
        return await (await lease.ready()).snapshot();
      } finally {
        await lease.release();
      }
    },
    async subscribe(callback, options) {
      const lease = acquire();
      try {
        const unsubscribe = await (await lease.ready()).subscribe(callback, options);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          try {
            unsubscribe();
          } finally {
            void lease.release();
          }
        };
      } catch (error) {
        await lease.release();
        throw error;
      }
    },
  };
}

async function openAttachmentDownload(
  runtimes: ConversationsRuntimeBroker,
  targetPromise: Promise<ConversationRuntimeTarget>,
  id: string,
  options: { signal?: AbortSignal }
) {
  const target = await targetPromise;
  const lease = runtimes.session(target.host);
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await lease.release();
  };
  try {
    const runtime = await lease.ready();
    if (!runtime.success) {
      await release();
      return err(runtime.error);
    }
    const result = await runtime.data.acp.downloadAttachment({ id }, options);
    if (!result.success) {
      await release();
      return result;
    }
    return {
      success: true as const,
      data: {
        meta: result.data.meta,
        source: releaseAfter(result.data.chunks(), release),
      },
    };
  } catch (error) {
    await release();
    throw error;
  }
}

function releaseAfter(
  source: AsyncIterable<Uint8Array>,
  release: () => Promise<void>
): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]() {
      const iterator = source[Symbol.asyncIterator]();
      let released = false;
      const releaseOnce = async () => {
        if (released) return;
        released = true;
        await release();
      };
      return {
        async next() {
          try {
            const result = await iterator.next();
            if (result.done) await releaseOnce();
            return result;
          } catch (error) {
            await releaseOnce();
            throw error;
          }
        },
        async return() {
          try {
            await iterator.return?.();
            return { done: true as const, value: undefined };
          } finally {
            await releaseOnce();
          }
        },
      };
    },
  };
}
