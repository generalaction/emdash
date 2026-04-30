import React from 'react';
import { isValidProviderId, type AgentProviderId } from '@shared/agent-provider-registry';
import type { AppSettings } from '@shared/app-settings';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { SettingRow } from './SettingRow';

const DEFAULT_AGENT: AgentProviderId = 'claude';

const DefaultAgentSettingsCard: React.FC = () => {
  const {
    value: defaultAgentValue,
    update,
    isLoading: loading,
    isSaving: saving,
  } = useAppSettingsKey('defaultAgent');

  const defaultAgent: AgentProviderId = isValidProviderId(defaultAgentValue)
    ? (defaultAgentValue as AgentProviderId)
    : DEFAULT_AGENT;

  const handleChange = (agent: AgentProviderId) => {
    update(agent as AppSettings['defaultAgent']);
  };

  return (
    <SettingRow
      title="Default agent"
      description="The agent that will be selected by default when creating a new task."
      control={
        <div className="w-[183px] shrink-0">
          <AgentSelector
            value={defaultAgent}
            onChange={handleChange}
            disabled={loading || saving}
            className="w-full"
          />
        </div>
      }
    />
  );
};

export default DefaultAgentSettingsCard;
