import React from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import {
  isValidProviderId,
  type AgentProviderId,
} from '@shared/core/agents/agent-provider-registry';
import type { AppSettings } from '@shared/core/app-settings';

const DEFAULT_AGENT: AgentProviderId = 'claude';

export const DefaultAgentSelector: React.FC = () => {
  const {
    value: defaultAgentValue,
    update,
    isLoading,
    isSaving,
  } = useAppSettingsKey('defaultAgent');

  const defaultAgent: AgentProviderId = isValidProviderId(defaultAgentValue)
    ? (defaultAgentValue as AgentProviderId)
    : DEFAULT_AGENT;

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
