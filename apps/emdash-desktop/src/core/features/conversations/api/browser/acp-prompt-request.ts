import { when } from 'mobx';
import { getAcpChatResourceManager } from '@core/features/conversations/browser/acp/acp-chat-resource-manager';
import type { AcpChatStore } from '@core/features/conversations/browser/acp/acp-chat-store';

const TURN_START_TIMEOUT_MS = 60_000;
const TURN_END_TIMEOUT_MS = 10 * 60_000;
const HISTORY_TAIL_TURNS = 5;

/**
 * First ACP conversation in the task that can take a prompt right now. Conversations with an
 * unsent draft are skipped because submitting clears the composer.
 */
export function findIdleAcpChat(taskId: string, projectId: string): AcpChatStore | undefined {
  for (const store of getAcpChatResourceManager(taskId, projectId).stores) {
    const { canSubmit, isWorking } = store.affordances;
    if (canSubmit && !isWorking && store.draftText === '' && store.draftAttachments.length === 0) {
      return store;
    }
  }
  return undefined;
}

/**
 * Sends a prompt and resolves with the assistant text of the turn it opened, or null when the
 * turn never starts, times out, or cannot be found in history.
 */
export async function requestAcpReply(
  store: AcpChatStore,
  text: string,
  hiddenContext: string
): Promise<string | null> {
  const session = store.session;
  if (!session) return null;

  store.submitPrompt(text, [], hiddenContext);
  try {
    await when(() => store.affordances.isWorking, { timeout: TURN_START_TIMEOUT_MS });
    await when(() => !store.affordances.isWorking, { timeout: TURN_END_TIMEOUT_MS });
  } catch {
    return null;
  }

  let history: Awaited<ReturnType<typeof session.loadHistory>>;
  try {
    history = await session.loadHistory(undefined, HISTORY_TAIL_TURNS);
  } catch {
    return null;
  }
  if (!history.success || history.data.kind !== 'available') return null;

  const turn = [...history.data.turns]
    .reverse()
    .find((candidate) =>
      candidate.items.some(
        (item) => item.kind === 'message' && item.role === 'user' && item.text.includes(text)
      )
    );
  if (!turn) return null;
  return turn.items
    .flatMap((item) => (item.kind === 'message' && item.role === 'assistant' ? [item.text] : []))
    .join('\n');
}
