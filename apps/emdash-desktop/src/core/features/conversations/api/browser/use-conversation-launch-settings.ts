import type { SerializedHostRef } from '@emdash/core/primitives/host/api';
import { toast } from '@emdash/ui/react/primitives';
import { useCallback, useState } from 'react';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import {
  agentSupportsAcp,
  agentSupportsAutoApprove,
  type AgentCapabilities,
} from '@core/primitives/agents/api';
import { useProviderSettings, patchProviderSettings } from './provider-preferences';

export interface ConversationLaunchSettings {
  autoApprove: boolean;
  useChatUi: boolean;
}

/** The interface is global; provider options are scoped. Automation drafts keep their own settings. */
export function useConversationLaunchSettings(
  host: SerializedHostRef,
  providerId: string | null,
  capabilities: AgentCapabilities | undefined,
  initialSettings?: ConversationLaunchSettings,
  projectId?: string
) {
  const key = providerId ? { host, providerId, projectId } : null;
  const { settings, ready } = useProviderSettings(key);
  const {
    value: preferredTransport,
    isLoading: transportLoading,
    isSaving: transportSaving,
    updateAsync: updatePreferredTransport,
  } = useAppSettingsKey('preferredConversationType');
  const [draft, setDraft] = useState(initialSettings);
  const isolated = initialSettings !== undefined;
  const useChatUi =
    agentSupportsAcp(capabilities) && (draft?.useChatUi ?? preferredTransport === 'acp');
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
      else
        void updatePreferredTransport(useChatUi ? 'acp' : 'pty').catch((error) =>
          toast.error('Could not save conversation interface', { description: String(error) })
        );
    },
    [isolated, updatePreferredTransport]
  );

  return {
    ready: ready && (isolated || (!transportLoading && !transportSaving)),
    settings,
    autoApprove: supported && (draft?.autoApprove ?? savedAutoApprove ?? false),
    setAutoApprove,
    useChatUi,
    setUseChatUi,
  };
}
