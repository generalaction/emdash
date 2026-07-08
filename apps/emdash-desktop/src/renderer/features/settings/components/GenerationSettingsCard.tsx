import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { useAgents } from '@renderer/lib/stores/use-agents';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { AGENT_PROVIDERS, type AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import { useAppSettingsKey } from '../use-app-settings-key';
import { SettingRow } from './SettingRow';

const ACP_PROVIDERS = AGENT_PROVIDERS.filter((provider) => provider.acpCapable);

export function GenerationSettingsCard() {
  const { value, update, isLoading, isSaving } = useAppSettingsKey('generation');
  const { data: agents } = useAgents();
  const disabled = isLoading || isSaving;
  const provider = value?.provider ?? 'codex';
  const model = value?.model ?? '';
  const selectedProvider = ACP_PROVIDERS.find((option) => option.id === provider);
  const models = agents?.find((agent) => agent.id === provider)?.capabilities.models;
  const modelOptions = models?.kind === 'selectable' ? models.modelOptions : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-normal text-foreground">Generation</h3>
        <p className="text-xs text-foreground-passive">
          Configure the ACP runtime used for commit messages and pull request drafts.
        </p>
      </div>
      <div className="flex flex-col gap-3 rounded-lg border bg-background-1 p-4">
        <SettingRow
          title="Agent"
          description="ACP runtime used to generate commit messages and pull request drafts."
          control={
            <Select
              value={provider}
              onValueChange={(provider) =>
                update({ provider: provider as AgentProviderId, model: '' })
              }
              disabled={disabled}
            >
              <SelectTrigger className="w-64 max-w-full">
                <SelectValue>
                  <span className="flex min-w-0 items-center gap-2">
                    <AgentIcon id={provider} size={16} className="rounded-sm" />
                    <span className="min-w-0 truncate">{selectedProvider?.name ?? provider}</span>
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ACP_PROVIDERS.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    <AgentIcon id={provider.id} size={16} className="rounded-sm" />
                    <span>{provider.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          title="Model"
          description="Optional model passed to the selected ACP agent. Use the CLI default when unset."
          control={
            <Select
              value={modelOptions && model in modelOptions ? model : ''}
              onValueChange={(model) => update({ model: model ?? '' })}
              disabled={disabled || !modelOptions}
            >
              <SelectTrigger className="w-64 max-w-full">
                <SelectValue placeholder="CLI default">
                  {modelOptions && model ? (modelOptions[model]?.name ?? model) : 'CLI default'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="min-w-64">
                <SelectItem value="">CLI default</SelectItem>
                {modelOptions
                  ? Object.entries(modelOptions).map(([id, option]) => (
                      <SelectItem key={id} value={id}>
                        <span className="min-w-0 truncate">{option.name}</span>
                      </SelectItem>
                    ))
                  : null}
              </SelectContent>
            </Select>
          }
        />
      </div>
    </div>
  );
}
