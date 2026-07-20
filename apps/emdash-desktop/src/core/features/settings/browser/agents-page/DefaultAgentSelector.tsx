import type { AgentProviderId } from '@emdash/plugins/agents';
import React from 'react';
import { useAgents } from '@core/features/agents/browser/use-agents';
import { useAppSettingsKey } from '@core/features/settings/browser/use-app-settings-key';
import type { AppSettings } from '@core/services/settings/api';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';

export const DefaultAgentSelector: React.FC = () => {
  const {
    value: defaultAgentValue,
    update,
    isLoading,
    isSaving,
  } = useAppSettingsKey('defaultAgent');
  const { data: agents } = useAgents();

  const defaultAgent =
    defaultAgentValue && agents?.some((agent) => agent.id === defaultAgentValue)
      ? defaultAgentValue
      : null;

  const handleChange = (agent: AgentProviderId) => {
    update(agent as AppSettings['defaultAgent']);
  };

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border bg-background-1 p-3 px-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm text-foreground">Default agent</span>
        <span className="text-xs text-foreground-muted">
          Selected by default when creating a new task.
        </span>
      </div>
      <div className="w-44 shrink-0">
        <AgentSelector
          value={defaultAgent}
          onChange={handleChange}
          disabled={isLoading || isSaving}
          className="w-full"
        />
      </div>
    </div>
  );
};
