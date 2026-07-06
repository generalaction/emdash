import { ORPCError, implement } from '@orpc/server';
import { RPCHandler } from '@orpc/server/message-port';
import { streamLiveUpdates } from '../../live/adapters/orpc';
import { AcpRuntime } from '../runtime/runtime';
import type { AcpRuntimeDeps, AcpStartInput } from '../runtime/types';
import { acpContract } from './contract';

export interface AcpRouterContext {
  runtime: AcpRuntime;
}

const i = implement(acpContract).$context<AcpRouterContext>();

export const acpRouter = i.router({
  startSession: i.startSession.handler(({ input, context }) =>
    context.runtime.startSession(toStartInput(input.input))
  ),
  resumeSession: i.resumeSession.handler(({ input, context }) =>
    context.runtime.resumeSession({
      ...toStartInput(input.input),
      sessionId: input.input.sessionId,
    })
  ),
  stopSession: i.stopSession.handler(({ input, context }) =>
    context.runtime.stopSession(input.conversationId)
  ),
  sendPrompt: i.sendPrompt.handler(({ input, context }) =>
    context.runtime.sendPrompt(input.conversationId, input.prompt)
  ),
  queuePrompt: i.queuePrompt.handler(({ input, context }) =>
    context.runtime.queuePrompt(input.conversationId, input.prompt)
  ),
  editQueuedPrompt: i.editQueuedPrompt.handler(({ input, context }) =>
    context.runtime.editQueuedPrompt(input.conversationId, input.id, input.input)
  ),
  deleteQueuedPrompt: i.deleteQueuedPrompt.handler(({ input, context }) =>
    context.runtime.deleteQueuedPrompt(input.conversationId, input.id)
  ),
  changeQueuePromptOrder: i.changeQueuePromptOrder.handler(({ input, context }) =>
    context.runtime.changeQueuePromptOrder(input.conversationId, input.ids)
  ),
  cancelTurn: i.cancelTurn.handler(({ input, context }) =>
    context.runtime.cancelTurn(input.conversationId)
  ),
  setModelOption: i.setModelOption.handler(({ input, context }) =>
    context.runtime.setModelOption(input.conversationId, input.dimension, input.value)
  ),
  setModeOption: i.setModeOption.handler(({ input, context }) =>
    context.runtime.setModeOption(input.conversationId, input.value)
  ),
  resolvePermission: i.resolvePermission.handler(({ input, context }) =>
    context.runtime.resolvePermission(input.conversationId, input.requestId, input.optionId)
  ),
  setPromptDraft: i.setPromptDraft.handler(({ input, context }) =>
    context.runtime.setPromptDraft(input.conversationId, input.draft)
  ),
  exportACPTranscript: i.exportACPTranscript.handler(({ input, context }) =>
    context.runtime.exportParsedTranscript(input.conversationId)
  ),
  exportRawAcpLog: i.exportRawAcpLog.handler(({ input, context }) =>
    context.runtime.exportRawAcpLog(input.conversationId)
  ),
  uploadAttachment: i.uploadAttachment.handler(({ input, context }) =>
    context.runtime.uploadAttachment(input)
  ),
  downloadAttachment: i.downloadAttachment.handler(async ({ input, context }) => {
    const result = await context.runtime.downloadAttachment(input.id);
    if (!result.success) return result;
    return {
      success: true as const,
      data: {
        ref: result.data.ref,
        data: new Uint8Array(result.data.data),
      },
    };
  }),
  deleteAttachment: i.deleteAttachment.handler(({ input, context }) =>
    context.runtime.deleteAttachment(input.id)
  ),
  getHistory: i.getHistory.handler(({ input, context }) =>
    context.runtime.getHistory(input.conversationId, input.before, input.limit)
  ),
  live: {
    sessionStateList: {
      snapshot: i.live.sessionStateList.snapshot.handler(({ context }) =>
        context.runtime.sessionsListLiveModel().snapshot()
      ),
      subscribe: i.live.sessionStateList.subscribe.handler(({ signal, context }) =>
        streamLiveUpdates(context.runtime.sessionsListLiveModel(), signal)
      ),
      unsubscribe: i.live.sessionStateList.unsubscribe.handler(() => undefined),
    },
    sessionState: {
      snapshot: i.live.sessionState.snapshot.handler(({ input, context }) => {
        const { conversationId } = input as { conversationId: string };
        const models = context.runtime.sessionLiveModels(conversationId);
        if (!models) throw notFound(`Unknown conversation '${conversationId}'`);
        return models.sessionState.snapshot();
      }),
      subscribe: i.live.sessionState.subscribe.handler(({ input, signal, context }) => {
        const { conversationId } = input as { conversationId: string };
        const models = context.runtime.sessionLiveModels(conversationId);
        if (!models) return emptyUpdates();
        return streamLiveUpdates(models.sessionState, signal);
      }),
      unsubscribe: i.live.sessionState.unsubscribe.handler(() => undefined),
    },
    sessionConfig: {
      snapshot: i.live.sessionConfig.snapshot.handler(({ input, context }) => {
        const { conversationId } = input as { conversationId: string };
        const models = context.runtime.sessionLiveModels(conversationId);
        if (!models) throw notFound(`Unknown conversation '${conversationId}'`);
        return models.config.snapshot();
      }),
      subscribe: i.live.sessionConfig.subscribe.handler(({ input, signal, context }) => {
        const { conversationId } = input as { conversationId: string };
        const models = context.runtime.sessionLiveModels(conversationId);
        if (!models) return emptyUpdates();
        return streamLiveUpdates(models.config, signal);
      }),
      unsubscribe: i.live.sessionConfig.unsubscribe.handler(() => undefined),
    },
    sessionUsage: {
      snapshot: i.live.sessionUsage.snapshot.handler(({ input, context }) => {
        const { conversationId } = input as { conversationId: string };
        const models = context.runtime.sessionLiveModels(conversationId);
        if (!models) throw notFound(`Unknown conversation '${conversationId}'`);
        return models.usage.snapshot();
      }),
      subscribe: i.live.sessionUsage.subscribe.handler(({ input, signal, context }) => {
        const { conversationId } = input as { conversationId: string };
        const models = context.runtime.sessionLiveModels(conversationId);
        if (!models) return emptyUpdates();
        return streamLiveUpdates(models.usage, signal);
      }),
      unsubscribe: i.live.sessionUsage.unsubscribe.handler(() => undefined),
    },
    plan: {
      snapshot: i.live.plan.snapshot.handler(({ input, context }) => {
        const { conversationId } = input as { conversationId: string };
        const models = context.runtime.sessionLiveModels(conversationId);
        if (!models) throw notFound(`Unknown conversation '${conversationId}'`);
        return models.plan.snapshot();
      }),
      subscribe: i.live.plan.subscribe.handler(({ input, signal, context }) => {
        const { conversationId } = input as { conversationId: string };
        const models = context.runtime.sessionLiveModels(conversationId);
        if (!models) return emptyUpdates();
        return streamLiveUpdates(models.plan, signal);
      }),
      unsubscribe: i.live.plan.unsubscribe.handler(() => undefined),
    },
    agents: {
      snapshot: i.live.agents.snapshot.handler(({ input, context }) => {
        const { conversationId } = input as { conversationId: string };
        const models = context.runtime.sessionLiveModels(conversationId);
        if (!models) throw notFound(`Unknown conversation '${conversationId}'`);
        return models.agents.snapshot();
      }),
      subscribe: i.live.agents.subscribe.handler(({ input, signal, context }) => {
        const { conversationId } = input as { conversationId: string };
        const models = context.runtime.sessionLiveModels(conversationId);
        if (!models) return emptyUpdates();
        return streamLiveUpdates(models.agents, signal);
      }),
      unsubscribe: i.live.agents.unsubscribe.handler(() => undefined),
    },
    activeTurn: {
      snapshot: i.live.activeTurn.snapshot.handler(({ input, context }) => {
        const { conversationId } = input as { conversationId: string };
        const models = context.runtime.sessionLiveModels(conversationId);
        if (!models) throw notFound(`Unknown conversation '${conversationId}'`);
        return models.activeTurn.snapshot();
      }),
      subscribe: i.live.activeTurn.subscribe.handler(({ input, signal, context }) => {
        const { conversationId } = input as { conversationId: string };
        const models = context.runtime.sessionLiveModels(conversationId);
        if (!models) return emptyUpdates();
        return streamLiveUpdates(models.activeTurn, signal);
      }),
      unsubscribe: i.live.activeTurn.unsubscribe.handler(() => undefined),
    },
    promptDraft: {
      snapshot: i.live.promptDraft.snapshot.handler(({ input, context }) => {
        const { conversationId } = input as { conversationId: string };
        const models = context.runtime.sessionLiveModels(conversationId);
        if (!models) throw notFound(`Unknown conversation '${conversationId}'`);
        return models.draft.snapshot();
      }),
      subscribe: i.live.promptDraft.subscribe.handler(({ input, signal, context }) => {
        const { conversationId } = input as { conversationId: string };
        const models = context.runtime.sessionLiveModels(conversationId);
        if (!models) return emptyUpdates();
        return streamLiveUpdates(models.draft, signal);
      }),
      unsubscribe: i.live.promptDraft.unsubscribe.handler(() => undefined),
    },
    terminals: {
      snapshot: i.live.terminals.snapshot.handler(({ input, context }) => {
        const { conversationId } = input as { conversationId: string };
        return context.runtime.terminalsLiveModel(conversationId).snapshot();
      }),
      subscribe: i.live.terminals.subscribe.handler(({ input, signal, context }) => {
        const { conversationId } = input as { conversationId: string };
        return streamLiveUpdates(context.runtime.terminalsLiveModel(conversationId), signal);
      }),
      unsubscribe: i.live.terminals.unsubscribe.handler(() => undefined),
    },
    terminalOutput: {
      snapshot: i.live.terminalOutput.snapshot.handler(({ input, context }) => {
        const { terminalId } = input as { terminalId: string };
        const log = context.runtime.terminalOutputLog(terminalId);
        if (!log) throw notFound(`Unknown terminal '${terminalId}'`);
        return log.snapshot();
      }),
      subscribe: i.live.terminalOutput.subscribe.handler(({ input, signal, context }) => {
        const { terminalId } = input as { terminalId: string };
        const log = context.runtime.terminalOutputLog(terminalId);
        if (!log) return emptyUpdates();
        return streamLiveUpdates(log, signal);
      }),
      unsubscribe: i.live.terminalOutput.unsubscribe.handler(() => undefined),
    },
  },
});

export type AcpRouter = typeof acpRouter;
export type AcpMessagePort = Parameters<RPCHandler<AcpRouterContext>['upgrade']>[0];

export function createAcpRuntime(router: AcpRouter, deps: AcpRuntimeDeps) {
  const runtime = new AcpRuntime(deps);
  return {
    runtime,
    router,
    servePort: (port: AcpMessagePort) => serveAcpPort(router, port, runtime),
  };
}

/**
 * Attaches the ACP router to a message port. The caller owns the port lifecycle
 * and must start the port after serving it when required by the transport.
 */
export function serveAcpPort(router: AcpRouter, port: AcpMessagePort, runtime: AcpRuntime): void {
  new RPCHandler(router).upgrade(port, { context: { runtime } });
}

async function* emptyUpdates(): AsyncGenerator<never> {}

function notFound(message: string): ORPCError<'NOT_FOUND', unknown> {
  return new ORPCError('NOT_FOUND', { message });
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
