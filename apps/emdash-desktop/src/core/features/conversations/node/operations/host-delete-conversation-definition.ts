import { formatHostRef, LOCAL_HOST_REF, parseHostRef } from '@emdash/core/primitives/host/api';
import { createOperationHandler } from '@emdash/core/primitives/kernel/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import type { Clock } from '@emdash/shared/scheduling';
import {
  hostDeleteConversationOperation,
  type HostDeleteConversationInput,
} from '@core/features/conversations/api/node/host-delete-conversation-operation';
import type { AppDb } from '@core/services/app-db/node/db';
import type { OperationDefinition } from '@core/services/operations/node';
import {
  needsConfirmation,
  rejectOperationOutcome,
  retryable,
  runOperationStage,
  stageOk,
} from '@core/services/operations/node';

const KILL_TIMEOUT_MS = 30_000;
const DELETE_TIMEOUT_MS = 30_000;

export type DeleteConversationOperationDependencies = {
  runtimes: Pick<RuntimeBroker, 'client'>;
};

type OperationRuntime = { db: AppDb; clock: Clock; initiatedBy?: string };

export const deleteConversationOperationContribution = {
  create: (
    dependencies: DeleteConversationOperationDependencies,
    runtime: OperationRuntime
  ): readonly OperationDefinition[] => [
    createHostDeleteConversationDefinition(dependencies, runtime),
  ],
};

/**
 * The `host.deleteConversation` verb (spec §4.3): killing any live session is part of the
 * verb — never a separate desktop-ordered step — followed by the idempotent index delete.
 * Rides the outbox: a delete issued while the host sleeps executes on reconnect; forgetting
 * the host cancels the queued entry through the standard pending-for-host sweep.
 */
export function createHostDeleteConversationDefinition(
  dependencies: DeleteConversationOperationDependencies,
  runtime: OperationRuntime
): OperationDefinition<typeof hostDeleteConversationOperation> {
  const handler = createOperationHandler(hostDeleteConversationOperation, async (ctx) => {
    const input = ctx.input;
    if (input.source === 'reconciler' && !input.confirmedAt) {
      rejectOperationOutcome(ctx, needsConfirmation('reconciler-proposed'));
    }

    const client = await dependencies.runtimes.client(parseHostRef(input.hostRef));
    if (!client.success) {
      rejectOperationOutcome(
        ctx,
        retryable(`Host ${input.hostRef} is unavailable`, 'host-unreachable')
      );
    }
    const runtimes = client.data;

    await runOperationStage(ctx, {
      id: 'kill-sessions',
      label: 'Stop live sessions',
      timeoutMs: KILL_TIMEOUT_MS,
      clock: runtime.clock,
      run: async () => {
        // Best effort: a conversation has at most one live session, of unknown type from
        // here, so both kills run; absent sessions are no-ops and kill failures must not
        // block record deletion (the host reaps orphaned sessions).
        try {
          await runtimes.acp.killSession({ conversationId: input.conversationId });
        } catch {
          // Swallowed by design; see stage comment.
        }
        try {
          await runtimes.tuiAgents.deleteSession({ conversationId: input.conversationId });
        } catch {
          // Swallowed by design; see stage comment.
        }
        return stageOk();
      },
    });

    await runOperationStage(ctx, {
      id: 'delete-record',
      label: 'Delete conversation record',
      timeoutMs: DELETE_TIMEOUT_MS,
      clock: runtime.clock,
      run: async () => {
        // Idempotent on the host (error: z.never()) — outbox retries replay it safely.
        await runtimes.conversations.delete({ id: input.conversationId });
        return stageOk();
      },
    });

    return { ok: true as const };
  });

  const example: HostDeleteConversationInput = {
    version: '1',
    source: 'user',
    hostOperationId: 'host-op-example',
    hostRef: formatHostRef(LOCAL_HOST_REF),
    conversationId: 'conversation-example',
    entityName: 'Example conversation',
    createdAt: 1,
  };
  return {
    definition: hostDeleteConversationOperation,
    handler,
    entityKind: 'conversation',
    displayName: 'Deleting conversation',
    examples: [{ definition: hostDeleteConversationOperation, input: example }],
  };
}
