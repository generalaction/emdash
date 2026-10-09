import { randomUUID } from 'node:crypto';
import {
  formatHostRef,
  type HostRef,
  type SerializedHostRef,
} from '@emdash/core/primitives/host/api';
import { KeyedMutex } from '@emdash/shared/concurrency';
import { log } from '@emdash/shared/logger';
import { and, eq, isNull } from 'drizzle-orm';
import { conversationWireEvents } from '@core/features/conversations/api/node';
import { conversationEvents } from '@core/features/conversations/api/node/conversation-events';
import {
  buildHostConversationCreateInput,
  compensateHostConversationRecord,
  conversationIdRegimeFor,
  createHostConversationRecord,
} from '@core/features/conversations/api/node/host-index';
import {
  conversationRegistryTable as conversations,
  createConversationRegistry,
} from '@core/features/conversations/api/node/registry';
import { mapConversationRowToConversation } from '@core/features/conversations/api/node/utils';
import type { ConversationsRuntimeBroker } from '@core/features/conversations/api/runtime-adapter';
import type { TaskSessionManager } from '@core/features/tasks/api/node/task-session-manager';
import { type ConversationConfig } from '@core/primitives/conversations/api';
import {
  type Conversation,
  type CreateConversationParams,
} from '@core/primitives/conversations/api';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import type { AppDb } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { tasks } from '@core/services/app-db/node/schema';
import { launchTuiConversation } from './launch-tui-conversation';

type ConversationCreateDb = Pick<AppDb, 'delete' | 'insert' | 'select' | 'update' | 'transaction'>;
const creationMutex = new KeyedMutex();

export type CompensationRunner = <T>(options: {
  action: () => Promise<T>;
  compensate: () => Promise<void>;
  onCompensationError?: (error: unknown) => void;
}) => Promise<T>;

export type ConversationWorkspaceIdentityResolver = Readonly<{
  resolve(workspaceId: string): Promise<{ host: HostRef; path: string } | null>;
}>;

export async function createConversation(
  params: CreateConversationParams,
  dependencies: Parameters<typeof createConversationUnlocked>[1]
): Promise<Conversation> {
  // Creation and its compensation must finish before another conversation claims the first name.
  return creationMutex.runExclusive(params.taskId, () =>
    createConversationUnlocked(params, dependencies)
  );
}

async function createConversationUnlocked(
  params: CreateConversationParams,
  dependencies: {
    db: ConversationCreateDb;
    telemetry: Pick<TelemetryService, 'capture'>;
    taskSessions: Pick<TaskSessionManager, 'getTask'>;
    withCompensation: CompensationRunner;
    runtimes: ConversationsRuntimeBroker;
    hostIsReachable: (hostRef: SerializedHostRef) => boolean;
    workspaceIdentity: ConversationWorkspaceIdentityResolver;
  }
): Promise<Conversation> {
  const { db: database, telemetry, withCompensation, runtimes } = dependencies;
  const id = params.id ?? randomUUID();
  const [existingConversation] = await database
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.taskId, params.taskId))
    .limit(1);

  const [taskRow] = await database
    .select({
      workspaceId: tasks.workspaceId,
      autoNameConversationId: tasks.autoNameConversationId,
    })
    .from(tasks)
    .where(eq(tasks.id, params.taskId))
    .limit(1);
  const identity = taskRow?.workspaceId
    ? await dependencies.workspaceIdentity.resolve(taskRow.workspaceId)
    : null;
  if (!identity) {
    throw new Error('createConversation: the task has no resolvable workspace');
  }

  // One rule for creation (spec §6.3): starting anything new against an offline host
  // is refused. This path was previously ungated because it only wrote client SQLite.
  if (
    identity.host.type === 'remote' &&
    !dependencies.hostIsReachable(formatHostRef(identity.host))
  ) {
    throw new Error(
      'The workspace host is offline. Reconnect the machine to create new conversations.'
    );
  }

  const conversationType = params.type ?? 'pty';
  const bindTaskName = !existingConversation && taskRow?.autoNameConversationId === '';

  const initialQueue = params.initialQueue?.filter((prompt) => prompt.text.trim());
  const configObj: ConversationConfig =
    conversationType === 'acp'
      ? {
          version: '1',
          type: 'acp',
          ...(params.options && { options: params.options }),
          ...(initialQueue?.length && { initialQueue }),
        }
      : {
          version: '1',
          type: 'pty',
          ...(params.autoApprove !== undefined && { autoApprove: params.autoApprove }),
          ...(params.model && { model: params.model }),
          ...(params.initialPrompt && { initialPrompt: params.initialPrompt }),
        };
  const config = configObj;

  // Host-first ordering (spec §6.2): the index is authoritative for conversation
  // existence, so the client registry link must never precede the record. Live sync
  // may adopt the record before this call returns; registry.register atomically claims it.
  const registered = await createHostConversationRecord(
    runtimes,
    identity.host,
    buildHostConversationCreateInput({
      id,
      provider: params.provider,
      type: conversationType,
      title: params.title,
      workspacePath: identity.path,
      config: configObj,
      createdAt: Date.now(),
    })
  );
  if (!registered.success) {
    throw new Error(`createConversation: host index registration failed: ${registered.message}`);
  }
  const compensateHostRecord = () => compensateHostConversationRecord(runtimes, identity.host, id);

  // The registry only touches the query-builder subset that ConversationCreateDb carries.
  const registry = createConversationRegistry(database as unknown as AppDb);
  const isRemote = identity.host.type === 'remote';
  let row: typeof conversations.$inferSelect;
  try {
    row = database.transaction((tx) => {
      const registeredRow = registry.register(
        {
          id,
          projectId: params.projectId,
          taskId: params.taskId,
          title: params.title,
          provider: params.provider,
          config,
          // Null means this conversation has not successfully spawned yet. PTY placeholder
          // ids and ACP/native provider ids are written only after their session exists.
          providerSessionId: null,
          isInitialConversation: params.isInitialConversation ?? false,
          type: conversationType,
          lastSessionActivityAt: new Date().toISOString(),
          cwd: identity.path,
          workspacePath: identity.path,
          idRegime: conversationIdRegimeFor(conversationType),
          location: isRemote ? 'remote' : 'local',
          sshConnectionId: isRemote ? identity.host.id : null,
        },
        tx
      );
      if (bindTaskName) {
        tx.update(tasks)
          .set({ autoNameConversationId: id })
          .where(
            and(
              eq(tasks.id, params.taskId),
              eq(tasks.projectId, params.projectId),
              eq(tasks.autoNameConversationId, ''),
              isNull(tasks.deletedAt)
            )
          )
          .run();
      }
      return registeredRow;
    });
  } catch (error) {
    await compensateHostRecord();
    throw error;
  }

  let conversation = mapConversationRowToConversation(row);
  if (conversation === null) {
    throw new Error(`createConversation: inserted row for ${id} is missing its task link`);
  }

  // ACP sessions start when chat calls startSession — no PTY session here.
  if (conversationType !== 'acp') {
    const launched = await withCompensation({
      action: () =>
        launchTuiConversation({
          projectId: params.projectId,
          taskId: params.taskId,
          conversationId: id,
          initialSize: params.initialSize,
          database,
          telemetry,
          taskSessions: dependencies.taskSessions,
        }),
      compensate: async () => {
        database.transaction((tx) => {
          registry.untrack([row.id], new Date().toISOString(), tx);
          registry.purge([row.id], tx);
          if (bindTaskName) {
            tx.update(tasks)
              .set({ autoNameConversationId: '' })
              .where(and(eq(tasks.id, params.taskId), eq(tasks.autoNameConversationId, id)))
              .run();
          }
        });
        await compensateHostRecord();
      },
      onCompensationError: (error) => {
        log.error('createConversation: failed to roll back conversation row after spawn failure', {
          conversationId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
    conversation = launched.conversation;
  }

  conversationEvents._emit('conversation:created', conversation);
  conversationWireEvents.emit(undefined, { type: 'created', conversation });
  appDbPokes.conversations.poke({ projectId: params.projectId, taskId: params.taskId });
  telemetry.capture('conversation_created', {
    provider: params.provider,
    is_first_in_task: existingConversation === undefined,
    project_id: params.projectId,
    task_id: params.taskId,
    conversation_id: id,
  });

  return conversation;
}
