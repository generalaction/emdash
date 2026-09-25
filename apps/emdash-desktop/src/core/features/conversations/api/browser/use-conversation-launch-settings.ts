import type { SerializedHostRef } from '@emdash/core/primitives/host/api';
import { useCallback, useState } from 'react';
import {
  agentSupportsAcp,
  agentSupportsAutoApprove,
  type AgentCapabilities,
} from '@core/primitives/agents/api';
import {
  useProviderSettings,
  patchProviderSettings,
  setPreferredTransport,
} from './provider-preferences';

export interface ConversationLaunchSettings {
  autoApprove: boolean;
  useChatUi: boolean;
}

/** Interactive defaults are scoped; automation drafts reuse catalogs but never inherit or change preferences. */
export function useConversationLaunchSettings(
  host: SerializedHostRef,
  providerId: string | null,
  capabilities: AgentCapabilities | undefined,
  initialSettings?: ConversationLaunchSettings,
  projectId?: string
) {
  const key = providerId ? { host, providerId, projectId } : null;
  const { settings, ready } = useProviderSettings(key);
  const [draft, setDraft] = useState(initialSettings);
  const isolated = initialSettings !== undefined;
  const useChatUi =
    agentSupportsAcp(capabilities) && (draft?.useChatUi ?? settings.transport === 'acp');
  const transport = useChatUi ? 'acp' : 'pty';
  const supported = agentSupportsAutoApprove(capabilities, transport);
  const savedAutoApprove = settings.pty.autoApprove;
  const setAutoApprove = useCallback(
    (autoApprove: boolean) => {
      if (!supported) return;
      if (isolated) setDraft((current) => current && { ...current, autoApprove });
      else if (providerId && supported) {
        void patchProviderSettings(
          { host, providerId, projectId },
          { transport: 'pty', autoApprove }
        );
      }
    },
    [isolated, providerId, supported, host, projectId]
  );
  const setUseChatUi = useCallback(
    (useChatUi: boolean) => {
      if (isolated) setDraft((current) => current && { ...current, useChatUi });
      else if (providerId)
        void setPreferredTransport({ host, providerId, projectId }, useChatUi ? 'acp' : 'pty');
    },
    [isolated, host, providerId, projectId]
  );

  return {
    ready,
    settings,
    autoApprove: supported && (draft?.autoApprove ?? savedAutoApprove ?? false),
    setAutoApprove,
    useChatUi,
    setUseChatUi,
  };
}
