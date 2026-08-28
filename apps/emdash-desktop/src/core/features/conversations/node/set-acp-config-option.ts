import { err, ok, type BaseError, type Result } from '@emdash/shared';
import { createConversationRegistry } from '@core/features/conversations/api/node/registry';
import type { ConversationConfig, ConversationConfigAcp } from '@core/primitives/conversations/api';
import type { HostConversationMutationDeps } from './host-mutation';
import { resolveConversationHostClient } from './host-mutation';

export type AcpPersistedConfigKey = 'model' | 'modeId' | 'effort';

export type SetAcpConfigOptionError = BaseError<
  'empty-value' | 'conversation-not-found' | 'not-acp-conversation' | 'host-rejected'
>;

export type SetAcpConfigOptionResult = {
  projectId: string | null;
  taskId: string | null;
  changed: boolean;
};

/** Persists one provider-native ACP selection through the authoritative host config. */
export async function setConversationAcpConfigOption(
  deps: HostConversationMutationDeps,
  conversationId: string,
  key: AcpPersistedConfigKey,
  value: string | null
): Promise<Result<SetAcpConfigOptionResult, SetAcpConfigOptionError>> {
  const normalized = value?.trim() || null;
  if (value !== null && normalized === null) return err({ type: 'empty-value' });

  let resolved: Awaited<ReturnType<typeof resolveConversationHostClient>>;
  try {
    resolved = await resolveConversationHostClient(deps, conversationId);
  } catch (error) {
    return err({
      type: 'conversation-not-found',
      message: error instanceof Error ? error.message : conversationId,
    });
  }
  const { row, client } = resolved;
  if (row.config?.type !== 'acp') {
    return err({ type: 'not-acp-conversation', message: conversationId });
  }

  const context = { projectId: row.projectId, taskId: row.taskId };
  if ((row.config[key] ?? null) === normalized) return ok({ ...context, changed: false });

  const config = patchAcpConfig(row.config, key, normalized);
  const updated = await client.updateConfig({ conversationId, config });
  if (!updated.success) {
    return err({ type: 'host-rejected', message: updated.error.message });
  }

  createConversationRegistry(deps.db).refresh(conversationId, {
    config: updated.data.config as ConversationConfig,
    updatedAt: new Date(updated.data.updatedAt).toISOString(),
    lastObservedAt: new Date().toISOString(),
  });
  return ok({ ...context, changed: true });
}

function patchAcpConfig(
  config: ConversationConfigAcp,
  key: AcpPersistedConfigKey,
  value: string | null
): ConversationConfigAcp {
  if (value !== null) return { ...config, [key]: value };
  const next = { ...config };
  delete next[key];
  return next;
}
