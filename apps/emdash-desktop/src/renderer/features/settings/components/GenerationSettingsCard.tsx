import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { Input } from '@renderer/lib/ui/input';
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
  const disabled = isLoading || isSaving;
  const provider = value?.provider ?? 'codex';
  const model = value?.model ?? '';

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-background-1 p-4">
      <SettingRow
        title="Generation agent"
        description="ACP runtime used to generate commit messages and pull request drafts."
        control={
          <Select
            value={provider}
            onValueChange={(provider) => update({ provider: provider as AgentProviderId })}
            disabled={disabled}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
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
        title="Generation model"
        description="Optional model passed to the selected ACP agent. Leave blank to use the CLI default."
        control={
          <Input
            className="w-56"
            placeholder="CLI default"
            value={model}
            onChange={(event) => update({ model: event.target.value })}
            disabled={disabled}
          />
        }
      />
    </div>
  );
}
