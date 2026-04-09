import React from 'react';
import { AgentSelector } from './AgentSelector';
import type { Agent } from '../types';
import { isValidProviderId } from '@shared/providers/registry';
import { useAppSettings } from '@/contexts/AppSettingsProvider';

const DEFAULT_AGENT: Agent = 'claude';

const DefaultAgentSettingsCard: React.FC = () => {
  const { settings, updateSettings, isLoading: loading, isSaving: saving } = useAppSettings();

  const defaultAgent: Agent = isValidProviderId(settings?.defaultProvider)
    ? (settings!.defaultProvider as Agent)
    : DEFAULT_AGENT;

  const handleChange = (agent: Agent) => {
    void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
      captureTelemetry('default_agent_changed', { agent });
    });
    updateSettings({ defaultProvider: agent });
  };

  return (
    <div id="default-agent-settings-card" className="flex items-center justify-between gap-4">
      <div className="flex flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium text-foreground">Default agent</p>
        <p className="text-sm text-muted-foreground">
          The agent that will be selected by default when creating a new task.
        </p>
      </div>
      <div className="w-[183px] flex-shrink-0">
        <AgentSelector
          value={defaultAgent}
          onChange={handleChange}
          disabled={loading || saving}
          className="w-full"
        />
      </div>
    </div>
  );
};

export default DefaultAgentSettingsCard;
