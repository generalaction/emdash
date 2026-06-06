import React from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { agentMeta } from '@renderer/lib/providers/meta';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { captureTelemetry } from '@renderer/utils/telemetryClient';
import { NATIVE_CHAT_PROVIDER_IDS, type ConversationUiMode } from '@shared/conversation-ui';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

const MODE_LABELS: Record<ConversationUiMode, string> = {
  terminal: 'CLI terminal',
  'native-chat': 'Native chat (experimental)',
};

const SUPPORTED_AGENT_LABELS = NATIVE_CHAT_PROVIDER_IDS.map((id) => agentMeta[id].label).join(', ');

const ConversationUiCard: React.FC = () => {
  const { value, update, isLoading, isSaving, isFieldOverridden, resetField } =
    useAppSettingsKey('conversationUi');
  const mode: ConversationUiMode = value?.mode ?? 'terminal';

  const applyMode = (next: ConversationUiMode) => {
    if (next === mode) return;
    captureTelemetry('setting_changed', { setting: 'conversation_ui' });
    update({ mode: next });
  };

  return (
    <SettingRow
      title="Conversation UI"
      description={`How agent conversations are rendered. Native chat is experimental, applies to new conversations on local tasks, and runs the agent non-interactively (no approval prompts). Supported: ${SUPPORTED_AGENT_LABELS}; other agents always use the CLI terminal.`}
      control={
        <>
          <ResetToDefaultButton
            visible={isFieldOverridden('mode')}
            defaultLabel={MODE_LABELS.terminal}
            onReset={() => resetField('mode')}
            disabled={isLoading || isSaving}
          />
          <Select
            value={mode}
            onValueChange={(next) => applyMode(next as ConversationUiMode)}
            disabled={isLoading || isSaving}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue>{MODE_LABELS[mode]}</SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="terminal">{MODE_LABELS.terminal}</SelectItem>
              <SelectItem value="native-chat">{MODE_LABELS['native-chat']}</SelectItem>
            </SelectContent>
          </Select>
        </>
      }
    />
  );
};

export default ConversationUiCard;
