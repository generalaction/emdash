import { err, ok, type BaseError, type Result } from '@emdash/shared';
import type { HostConversationMutationDeps } from './host-mutation';
import { setConversationAcpConfigOption } from './set-acp-config-option';

export type SetModeIdError = BaseError<
  'empty-mode-id' | 'conversation-not-found' | 'not-acp-conversation' | 'host-rejected'
>;

/**
 * Persists the last user-selected ACP session mode id into the conversation's config so
 * it can be re-applied on the next session start/resume. Config is host-resident and
 * client-editable (spec §3.2), so the write is a foreground `updateConfig` wire mutation;
 * the local cache only holds the host-acknowledged config from the response.
 *
 * Mode ids only exist for ACP conversations, so non-ACP configs are rejected.
 * Returns the conversation routing context for callers that need to emit an update.
 */
export async function setConversationModeId(
  deps: HostConversationMutationDeps,
  conversationId: string,
  modeId: string
): Promise<Result<{ projectId: string | null; taskId: string | null }, SetModeIdError>> {
  const trimmed = modeId.trim();
  if (!trimmed) return err({ type: 'empty-mode-id' });

  const result = await setConversationAcpConfigOption(deps, conversationId, 'modeId', trimmed);
  if (!result.success) return err(result.error as SetModeIdError);
  return ok({ projectId: result.data.projectId, taskId: result.data.taskId });
}
