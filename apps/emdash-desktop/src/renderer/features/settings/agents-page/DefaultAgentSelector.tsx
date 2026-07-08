import React, { useMemo } from 'react';
import { ResetToDefaultButton } from '@renderer/features/settings/components/ResetToDefaultButton';
import { SettingRow } from '@renderer/features/settings/components/SettingRow';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { useAgents } from '@renderer/lib/stores/use-agents';
import { Separator } from '@renderer/lib/ui/separator';
import type { AgentModelOption } from '@shared/core/agents/agent-payload';
import {
  isValidProviderId,
  type AgentProviderId,
} from '@shared/core/agents/agent-provider-registry';
import type { AppSettings, AppSettingsKey } from '@shared/core/app-settings';
import { DefaultModelSelect, type ModelDefaultKey } from './DefaultModelSelect';

const DEFAULT_AGENT: AgentProviderId = 'claude';

type AgentDefaultKey = Extract<AppSettingsKey, 'defaultAgent' | 'defaultAutomationAgent'>;
type AgentDefaultValue = AppSettings[AgentDefaultKey];
type ModelDefaultValue = AppSettings[ModelDefaultKey];

type DefaultAgentModelRowProps = {
  title: string;
  description: string;
  agentSettingKey: AgentDefaultKey;
  modelSettingKey: ModelDefaultKey;
};

function modelOptionsForAgent(
  agentId: AgentProviderId,
  agents: ReturnType<typeof useAgents>['data']
): Record<string, AgentModelOption> | null {
  const models = agents?.find((agent) => agent.id === agentId)?.capabilities.models;
  return models?.kind === 'selectable' ? models.modelOptions : null;
}

function DefaultAgentModelRow({
  title,
  description,
  agentSettingKey,
  modelSettingKey,
}: DefaultAgentModelRowProps) {
  const {
    value: defaultAgentValue,
    update: updateDefaultAgent,
    reset: resetDefaultAgent,
    isLoading: isAgentLoading,
    isSaving: isAgentSaving,
    isOverridden: isAgentOverridden,
  } = useAppSettingsKey(agentSettingKey);
  const { update: updateDefaultModel } = useAppSettingsKey(modelSettingKey);
  const { data: agents } = useAgents();

  const defaultAgent: AgentProviderId = isValidProviderId(defaultAgentValue)
    ? (defaultAgentValue as AgentProviderId)
    : DEFAULT_AGENT;
  const modelOptions = useMemo(
    () => modelOptionsForAgent(defaultAgent, agents),
    [agents, defaultAgent]
  );

  const handleAgentChange = (agent: AgentProviderId) => {
    updateDefaultAgent(agent as AgentDefaultValue);
    updateDefaultModel(null as ModelDefaultValue);
  };

  const isDisabled = isAgentLoading || isAgentSaving;

  return (
    <SettingRow
      title={title}
      description={description}
      control={
        <div className="flex min-w-0 flex-wrap justify-end gap-2">
          <div className="flex items-center gap-1">
            <ResetToDefaultButton
              visible={isAgentOverridden}
              defaultLabel="Claude Code"
              onReset={resetDefaultAgent}
              disabled={isDisabled}
            />
            <AgentSelector
              value={defaultAgent}
              onChange={handleAgentChange}
              disabled={isDisabled}
              className="h-8 w-44"
            />
          </div>
          <DefaultModelSelect
            agentId={defaultAgent}
            modelSettingKey={modelSettingKey}
            modelOptions={modelOptions}
          />
        </div>
      }
    />
  );
}

export const DefaultAgentSelector: React.FC = () => (
  <section className="flex flex-col gap-3 pt-3">
    <div className="px-3">
      <h3 className="text-sm font-normal text-foreground">Defaults</h3>
    </div>
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-background-1 p-4">
      <DefaultAgentModelRow
        title="Default agent"
        description="Used by default when creating new tasks and conversations."
        agentSettingKey="defaultAgent"
        modelSettingKey="defaultModel"
      />
      <Separator />
      <DefaultAgentModelRow
        title="Automation default agent"
        description="Used when an automation does not have a specific agent or model saved."
        agentSettingKey="defaultAutomationAgent"
        modelSettingKey="defaultAutomationModel"
      />
    </div>
  </section>
);
