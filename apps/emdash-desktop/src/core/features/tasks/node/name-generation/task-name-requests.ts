import { randomUUID } from 'node:crypto';
import { formatHostRef, hostRefFromParts, type HostRef } from '@emdash/core/primitives/host/api';
import { acpApiContract, type TranscriptTurn } from '@emdash/core/runtimes/acp/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { log } from '@emdash/shared/logger';
import { retry, retrySchedules } from '@emdash/shared/scheduling';
import { observe, remote } from '@emdash/wire/state';
import { and, eq, isNull } from 'drizzle-orm';
import { createConversationRegistry } from '@core/features/conversations/api/node/registry';
import type { Task } from '@core/primitives/tasks/api';
import type { AgentTaskNameError } from '@core/primitives/tasks/api/tasks';
import type { AppDb } from '@core/services/app-db/node/db';
import { tasks } from '@core/services/app-db/node/schema';
import { nameTaskFromConversation } from '../operations/nameTaskFromConversation';

type NameRequest = {
  projectId: string;
  taskId: string;
  conversationId: string;
  promptId: string;
  expectedName: string;
  host: HostRef;
  timer: ReturnType<typeof setTimeout>;
  scope: Scope;
};

export function taskNameFromReply(turn: TranscriptTurn): string | null {
  if (turn.outcome?.kind !== 'done') return null;
  const message = turn.items
    .filter((item) => item.kind === 'message' && item.role === 'assistant')
    .at(-1);
  if (message?.kind !== 'message') return null;
  let name = message.text.trim();
  const quoted = /^(`|"|'|\*\*)(.*?)\1$/.exec(name);
  if (quoted) name = quoted[2].trim();
  if (!name || name.length > 64 || !/^[a-z0-9]+(?:[ -]+[a-z0-9]+)*$/i.test(name)) return null;
  const words = name.split(/[ -]+/);
  return words.length <= 5 ? words.join('-') : null;
}

/** Desktop-owned requests continue when the user switches away from the conversation. */
export class TaskNameRequests {
  private readonly pending = new Map<string, NameRequest>();

  constructor(
    private readonly db: AppDb,
    private readonly runtimes: RuntimeBroker,
    private readonly preserveCapitalization: () => Promise<boolean>,
    private readonly onNamed: (task: Task) => void
  ) {}

  async request(input: {
    projectId: string;
    taskId: string;
    conversationId: string;
  }): Promise<Result<void, AgentTaskNameError>> {
    const task = this.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.id, input.taskId),
          eq(tasks.projectId, input.projectId),
          isNull(tasks.deletedAt),
          isNull(tasks.archivedAt)
        )
      )
      .get();
    if (!task) return err({ type: 'task-not-found', message: 'The task is unavailable.' });
    const conversation = createConversationRegistry(this.db).getLive(input.conversationId);
    if (
      !conversation ||
      conversation.taskId !== task.id ||
      conversation.projectId !== task.projectId
    ) {
      return err({
        type: 'conversation-not-found',
        message: 'This conversation does not belong to the task.',
      });
    }
    if (conversation.type !== 'acp') {
      return err({
        type: 'unsupported-conversation',
        message: 'AI naming commands are available in Chat UI.',
      });
    }
    for (const previous of this.pending.values()) {
      if (previous.taskId === task.id) this.clear(previous);
    }
    const promptId = randomUUID();
    const request: NameRequest = {
      ...input,
      promptId,
      expectedName: task.name,
      host: hostRefFromParts(conversation.location, conversation.sshConnectionId),
      scope: createScope({ label: `task-name-request:${task.id}` }),
      timer: setTimeout(() => {
        this.clear(request);
        log.warn('Task naming request expired', { taskId: request.taskId });
      }, 10 * 60_000),
    };
    request.timer.unref();
    this.pending.set(input.conversationId, request);
    this.db.update(tasks).set({ autoNameConversationId: null }).where(eq(tasks.id, task.id)).run();
    try {
      const client = await this.runtimes.client(request.host);
      if (!client.success) throw new Error(client.error.message);
      const session = remote(acpApiContract.session, client.data.acp.session, {
        scope: request.scope,
      });
      let position: string | undefined;
      let scheduledPosition: string | undefined;
      let applyChain = Promise.resolve();
      observe(
        session({ conversationId: input.conversationId }).states.state,
        (snapshot) => {
          if (snapshot.status === 'loading' || !snapshot.value?.transcript) return;
          const transcript = snapshot.value.transcript;
          const nextPosition = `${transcript.generation}:${transcript.historyRevision}`;
          if (position === nextPosition || scheduledPosition === nextPosition) return;
          scheduledPosition = nextPosition;
          applyChain = applyChain
            .then(async () => {
              if (position === nextPosition) return;
              await this.settle(input.conversationId);
              position = nextPosition;
            })
            .catch((error) => {
              if (request.scope.signal.aborted) return;
              log.warn('Could not apply an AI task name', {
                taskId: task.id,
                error: String(error),
              });
            })
            .finally(() => {
              if (scheduledPosition === nextPosition) scheduledPosition = undefined;
            });
        },
        { scope: request.scope }
      );
      const sent = await client.data.acp.sendPrompt({
        conversationId: input.conversationId,
        promptId,
        prompt: {
          text: 'Suggest a fresh task name based on the current work in this conversation.',
          hiddenContext:
            'This request only names the task. Reply with only a concise descriptive name of up to five words and 64 characters, using letters, numbers, spaces, and hyphens. Do not use tools, change files, or start new work.',
        },
      });
      if (!sent.success) throw new Error('The conversation could not accept the naming request.');
      return ok(undefined);
    } catch (error) {
      this.clear(request);
      log.warn('Could not request an AI task name', { taskId: task.id, error: String(error) });
      return err({
        type: 'request-failed',
        message:
          'Could not ask the conversation AI for a name. Reconnect the conversation and try again.',
      });
    }
  }

  async settle(conversationId: string): Promise<void> {
    const request = this.pending.get(conversationId);
    if (!request) return;
    const ownsConversation = () => {
      const current = createConversationRegistry(this.db).getLive(conversationId);
      return (
        current?.taskId === request.taskId &&
        current.projectId === request.projectId &&
        formatHostRef(hostRefFromParts(current.location, current.sshConnectionId)) ===
          formatHostRef(request.host)
      );
    };
    if (!ownsConversation()) {
      this.clear(request);
      return;
    }
    const { history, preserveCapitalization } = await retry(
      async () => {
        const client = await this.runtimes.client(request.host);
        if (!client.success) throw new Error('The conversation host is unavailable.');
        const result = await client.data.acp.loadHistory({ conversationId, limit: 100 });
        if (!result.success || result.data.kind !== 'available') {
          throw new Error('The naming reply is not available yet.');
        }
        return {
          history: result.data,
          preserveCapitalization: await this.preserveCapitalization(),
        };
      },
      {
        signal: request.scope.signal,
        schedule: retrySchedules.exponential({ initialMs: 250, maxMs: 1000, maxRetries: 3 }),
        shouldRetry: () => true,
      }
    );
    const turn = history.turns.find((candidate) =>
      candidate.items.some(
        (item) =>
          item.kind === 'message' && item.role === 'user' && item.promptId === request.promptId
      )
    );
    if (!turn || !turn.outcome || this.pending.get(conversationId) !== request) return;
    this.clear(request);
    if (!ownsConversation()) return;
    const suggestion = taskNameFromReply(turn);
    if (!suggestion) {
      log.warn('Conversation AI did not return a valid task name', { taskId: request.taskId });
      return;
    }
    const named = await nameTaskFromConversation(
      this.db,
      conversationId,
      suggestion,
      preserveCapitalization,
      request
    );
    if (named) this.onNamed(named);
  }

  cancelTask(taskId: string, projectId?: string): void {
    for (const request of this.pending.values()) {
      if (
        request.taskId === taskId &&
        (projectId === undefined || request.projectId === projectId)
      ) {
        this.clear(request);
      }
    }
  }

  private clear(request: NameRequest): void {
    clearTimeout(request.timer);
    void request.scope.dispose();
    if (this.pending.get(request.conversationId) === request) {
      this.pending.delete(request.conversationId);
    }
  }
}
