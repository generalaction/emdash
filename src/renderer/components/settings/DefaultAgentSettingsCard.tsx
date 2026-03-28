import React from 'react';
import { isValidProviderId } from '@shared/agent-provider-registry';
import { useAppSettings } from '@renderer/core/app/AppSettingsProvider';
import type { Agent } from '../../types';
import { AgentSelector } from '../agent-selector';
import { SettingRow } from './SettingRow';

const DEFAULT_AGENT: Agent = 'claude';

const DefaultAgentSettingsCard: React.FC = () => {
  const { settings, updateSettings, isLoading: loading, isSaving: saving } = useAppSettings();

  const defaultAgent: Agent = isValidProviderId(settings?.defaultAgent)
    ? (settings!.defaultAgent as Agent)
    : DEFAULT_AGENT;

  const handleChange = (agent: Agent) => {
    updateSettings({ key: 'defaultAgent', value: agent });
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
