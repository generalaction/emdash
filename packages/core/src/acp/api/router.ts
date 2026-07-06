import { ORPCError, implement } from '@orpc/server';
import { RPCHandler } from '@orpc/server/message-port';
import { streamLiveUpdates } from '../../live/adapters/orpc';
import type { AcpRuntime } from '../runtime/runtime';
import type { AcpStartInput } from '../runtime/types';
import { acpContract } from './contract';

const i = implement(acpContract);

export function createAcpRouter(runtime: AcpRuntime) {
  return i.router({
    startSession: i.startSession.handler(({ input }) =>
      runtime.startSession(toStartInput(input.input))
    ),
    resumeSession: i.resumeSession.handler(({ input }) =>
      runtime.resumeSession({
        ...toStartInput(input.input),
        sessionId: input.input.sessionId,
      })
    ),
    stopSession: i.stopSession.handler(({ input }) => runtime.stopSession(input.conversationId)),
    sendPrompt: i.sendPrompt.handler(({ input }) =>
      runtime.sendPrompt(input.conversationId, input.prompt)
    ),
    queuePrompt: i.queuePrompt.handler(({ input }) =>
      runtime.queuePrompt(input.conversationId, input.prompt)
    ),
    editQueuedPrompt: i.editQueuedPrompt.handler(({ input }) =>
      runtime.editQueuedPrompt(input.conversationId, input.id, input.input)
    ),
    deleteQueuedPrompt: i.deleteQueuedPrompt.handler(({ input }) =>
      runtime.deleteQueuedPrompt(input.conversationId, input.id)
    ),
    changeQueuePromptOrder: i.changeQueuePromptOrder.handler(({ input }) =>
      runtime.changeQueuePromptOrder(input.conversationId, input.ids)
    ),
    cancelTurn: i.cancelTurn.handler(({ input }) => runtime.cancelTurn(input.conversationId)),
    setModelOption: i.setModelOption.handler(({ input }) =>
      runtime.setModelOption(input.conversationId, input.dimension, input.value)
    ),
    setModeOption: i.setModeOption.handler(({ input }) =>
      runtime.setModeOption(input.conversationId, input.value)
    ),
    resolvePermission: i.resolvePermission.handler(({ input }) =>
      runtime.resolvePermission(input.conversationId, input.requestId, input.optionId)
    ),
    editCurrentPrompt: i.editCurrentPrompt.handler(notImplemented),
    exportACPTranscript: i.exportACPTranscript.handler(({ input }) =>
      runtime.exportParsedTranscript(input.conversationId)
    ),
    exportRawAcpLog: i.exportRawAcpLog.handler(({ input }) =>
      runtime.exportRawAcpLog(input.conversationId)
    ),
    uploadAttachment: i.uploadAttachment.handler(({ input }) => runtime.uploadAttachment(input)),
    downloadAttachment: i.downloadAttachment.handler(async ({ input }) => {
      const result = await runtime.downloadAttachment(input.id);
      if (!result.success) return result;
      return {
        success: true as const,
        data: {
          ref: result.data.ref,
          data: new Uint8Array(result.data.data),
        },
      };
    }),
    deleteAttachment: i.deleteAttachment.handler(({ input }) => runtime.deleteAttachment(input.id)),
    getHistory: i.getHistory.handler(({ input }) =>
      runtime.getHistory(input.conversationId, input.before, input.limit)
    ),
    live: {
      sessionStateList: {
        snapshot: i.live.sessionStateList.snapshot.handler(() =>
          runtime.sessionsListLiveModel().snapshot()
        ),
        subscribe: i.live.sessionStateList.subscribe.handler(({ signal }) =>
          streamLiveUpdates(runtime.sessionsListLiveModel(), signal)
        ),
        unsubscribe: i.live.sessionStateList.unsubscribe.handler(() => undefined),
      },
      sessionState: {
        snapshot: i.live.sessionState.snapshot.handler(({ input }) => {
          const { conversationId } = input as { conversationId: string };
          const models = runtime.sessionLiveModels(conversationId);
          if (!models) throw notFound(`Unknown conversation '${conversationId}'`);
          return models.sessionState.snapshot();
        }),
        subscribe: i.live.sessionState.subscribe.handler(({ input, signal }) => {
          const { conversationId } = input as { conversationId: string };
          const models = runtime.sessionLiveModels(conversationId);
          if (!models) return emptyUpdates();
          return streamLiveUpdates(models.sessionState, signal);
        }),
        unsubscribe: i.live.sessionState.unsubscribe.handler(() => undefined),
      },
      sessionConfig: {
        snapshot: i.live.sessionConfig.snapshot.handler(({ input }) => {
          const { conversationId } = input as { conversationId: string };
          const models = runtime.sessionLiveModels(conversationId);
          if (!models) throw notFound(`Unknown conversation '${conversationId}'`);
          return models.config.snapshot();
        }),
        subscribe: i.live.sessionConfig.subscribe.handler(({ input, signal }) => {
          const { conversationId } = input as { conversationId: string };
          const models = runtime.sessionLiveModels(conversationId);
          if (!models) return emptyUpdates();
          return streamLiveUpdates(models.config, signal);
        }),
        unsubscribe: i.live.sessionConfig.unsubscribe.handler(() => undefined),
      },
      plan: {
        snapshot: i.live.plan.snapshot.handler(({ input }) => {
          const { conversationId } = input as { conversationId: string };
          const models = runtime.sessionLiveModels(conversationId);
          if (!models) throw notFound(`Unknown conversation '${conversationId}'`);
          return models.plan.snapshot();
        }),
        subscribe: i.live.plan.subscribe.handler(({ input, signal }) => {
          const { conversationId } = input as { conversationId: string };
          const models = runtime.sessionLiveModels(conversationId);
          if (!models) return emptyUpdates();
          return streamLiveUpdates(models.plan, signal);
        }),
        unsubscribe: i.live.plan.unsubscribe.handler(() => undefined),
      },
      agents: {
        snapshot: i.live.agents.snapshot.handler(({ input }) => {
          const { conversationId } = input as { conversationId: string };
          const models = runtime.sessionLiveModels(conversationId);
          if (!models) throw notFound(`Unknown conversation '${conversationId}'`);
          return models.agents.snapshot();
        }),
        subscribe: i.live.agents.subscribe.handler(({ input, signal }) => {
          const { conversationId } = input as { conversationId: string };
          const models = runtime.sessionLiveModels(conversationId);
          if (!models) return emptyUpdates();
          return streamLiveUpdates(models.agents, signal);
        }),
        unsubscribe: i.live.agents.unsubscribe.handler(() => undefined),
      },
      activeTurn: {
        snapshot: i.live.activeTurn.snapshot.handler(({ input }) => {
          const { conversationId } = input as { conversationId: string };
          const models = runtime.sessionLiveModels(conversationId);
          if (!models) throw notFound(`Unknown conversation '${conversationId}'`);
          return models.activeTurn.snapshot();
        }),
        subscribe: i.live.activeTurn.subscribe.handler(({ input, signal }) => {
          const { conversationId } = input as { conversationId: string };
          const models = runtime.sessionLiveModels(conversationId);
          if (!models) return emptyUpdates();
          return streamLiveUpdates(models.activeTurn, signal);
        }),
        unsubscribe: i.live.activeTurn.unsubscribe.handler(() => undefined),
      },
      terminals: {
        snapshot: i.live.terminals.snapshot.handler(({ input }) => {
          const { conversationId } = input as { conversationId: string };
          return runtime.terminalsLiveModel(conversationId).snapshot();
        }),
        subscribe: i.live.terminals.subscribe.handler(({ input, signal }) => {
          const { conversationId } = input as { conversationId: string };
          return streamLiveUpdates(runtime.terminalsLiveModel(conversationId), signal);
        }),
        unsubscribe: i.live.terminals.unsubscribe.handler(() => undefined),
      },
      terminalOutput: {
        snapshot: i.live.terminalOutput.snapshot.handler(({ input }) => {
          const { terminalId } = input as { terminalId: string };
          const log = runtime.terminalOutputLog(terminalId);
          if (!log) throw notFound(`Unknown terminal '${terminalId}'`);
          return log.snapshot();
        }),
        subscribe: i.live.terminalOutput.subscribe.handler(({ input, signal }) => {
          const { terminalId } = input as { terminalId: string };
          const log = runtime.terminalOutputLog(terminalId);
          if (!log) return emptyUpdates();
          return streamLiveUpdates(log, signal);
        }),
        unsubscribe: i.live.terminalOutput.unsubscribe.handler(() => undefined),
      },
    },
  });
}

export type AcpRouter = ReturnType<typeof createAcpRouter>;
export type AcpMessagePort = Parameters<RPCHandler<Record<never, never>>['upgrade']>[0];

/**
 * Attaches the ACP router to a message port. The caller owns the port lifecycle
 * and must start the port after serving it when required by the transport.
 */
export function serveAcpPort(router: AcpRouter, port: AcpMessagePort): void {
  new RPCHandler(router).upgrade(port);
}

async function* emptyUpdates(): AsyncGenerator<never> {}

function notFound(message: string): ORPCError<'NOT_FOUND', unknown> {
  return new ORPCError('NOT_FOUND', { message });
}

function notImplemented(): never {
  throw new ORPCError('NOT_IMPLEMENTED', { message: 'This procedure is not yet implemented.' });
}

function toStartInput(input: {
  conversationId: string;
  projectId: string;
  taskId: string;
  providerId: string;
  workspaceId: string;
  cwd: string;
  sessionId?: string | null;
  model?: string | null;
  initialPrompt?: string;
  sessionConfig?: { model?: string };
}): AcpStartInput {
  return {
    conversationId: input.conversationId,
    projectId: input.projectId,
    taskId: input.taskId,
    providerId: input.providerId,
    workspaceId: input.workspaceId,
    cwd: input.cwd,
    sessionId: input.sessionId ?? null,
    model: input.model ?? input.sessionConfig?.model ?? null,
    initialPrompt: input.initialPrompt,
  };
}
