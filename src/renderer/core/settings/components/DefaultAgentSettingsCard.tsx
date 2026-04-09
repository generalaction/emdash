import React from 'react';
import { isValidProviderId } from '@shared/agent-provider-registry';
import type { AppSettings } from '@shared/app-settings';
import { AgentSelector } from '@renderer/components/agent-selector';
import { useAppSettingsKey } from '@renderer/core/settings/use-app-settings-key';
import type { Agent } from '@renderer/types';
import { SettingRow } from './SettingRow';

const DEFAULT_AGENT: Agent = 'claude';

const DefaultAgentSettingsCard: React.FC = () => {
  const {
    value: defaultAgentValue,
    update,
    isLoading: loading,
    isSaving: saving,
  } = useAppSettingsKey('defaultAgent');

  const defaultAgent: Agent = isValidProviderId(defaultAgentValue)
    ? (defaultAgentValue as Agent)
    : DEFAULT_AGENT;

  const handleChange = (agent: Agent) => {
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
