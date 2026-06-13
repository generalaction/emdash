import { Check, ChevronsUpDown } from 'lucide-react';
import React from 'react';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import {
  getAgentModelSupport,
  MODEL_SELECTABLE_PROVIDER_IDS,
} from '@shared/core/agents/agent-models';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import { useAgentModelSettings } from '../use-agent-model-settings';
import { SettingRow } from './SettingRow';

/** Sentinel used by the dropdowns to represent "fall back to the CLI default". */
const DEFAULT_OPTION_VALUE = '__default__';

/** Labels shown for the "fall back to the CLI default" option in each dropdown. */
const MODEL_DEFAULT_LABEL = 'Model Default';
const EFFORT_DEFAULT_LABEL = 'Effort Default';

type Option = { id: string; label: string };

function labelForOption(
  options: ReadonlyArray<Option>,
  value: string | undefined,
  defaultLabel: string
): string {
  if (!value) return defaultLabel;
  return options.find((option) => option.id === value)?.label ?? value;
}

interface OptionDropdownProps {
  value: string | undefined;
  options: ReadonlyArray<Option>;
  defaultLabel: string;
  triggerClassName: string;
  disabled: boolean;
  ariaLabel: string;
  onChange: (value: string | undefined) => void;
}

function OptionDropdown({
  value,
  options,
  defaultLabel,
  triggerClassName,
  disabled,
  ariaLabel,
  onChange,
}: OptionDropdownProps) {
  const allOptions: ReadonlyArray<Option> = [
    { id: DEFAULT_OPTION_VALUE, label: defaultLabel },
    ...options,
  ];
  const selectedId = value ?? DEFAULT_OPTION_VALUE;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            disabled={disabled}
            aria-label={ariaLabel}
            className={cn(
              'h-8 justify-between gap-2 rounded-md border-border bg-background-1 px-2.5 font-normal text-foreground hover:bg-background-2',
              triggerClassName
            )}
          />
        }
      >
        <span className="truncate">{labelForOption(options, value, defaultLabel)}</span>
        <ChevronsUpDown className="size-4 shrink-0 text-foreground-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-max">
        {allOptions.map((option) => (
          <DropdownMenuItem
            key={option.id}
            className="justify-between gap-4"
            onClick={() => onChange(option.id === DEFAULT_OPTION_VALUE ? undefined : option.id)}
          >
            <span className="truncate">{option.label}</span>
            {option.id === selectedId && (
              <Check className="size-4 shrink-0 text-foreground-muted" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ProviderModelRowProps {
  providerId: AgentProviderId;
  disabled: boolean;
  model: string | undefined;
  reasoningEffort: string | undefined;
  onModelChange: (model: string | undefined) => void;
  onReasoningChange: (effort: string | undefined) => void;
}

function ProviderModelRow({
  providerId,
  disabled,
  model,
  reasoningEffort,
  onModelChange,
  onReasoningChange,
}: ProviderModelRowProps) {
  const support = getAgentModelSupport(providerId);
  const config = agentConfig[providerId];
  if (!support) return null;

  return (
    <SettingRow
      title={
        <span className="flex items-center gap-2">
          <AgentLogo
            logo={config.logo}
            logoDark={config.logoDark}
            alt={config.alt}
            isSvg={config.isSvg}
            invertInDark={config.invertInDark}
            className="h-4 w-4 shrink-0 rounded-sm"
          />
          {config.name}
        </span>
      }
      control={
        <div className="flex items-center gap-1.5">
          <OptionDropdown
            value={model}
            options={support.models}
            defaultLabel={MODEL_DEFAULT_LABEL}
            triggerClassName="w-[170px]"
            disabled={disabled}
            ariaLabel={`${config.name} model`}
            onChange={onModelChange}
          />
          {support.reasoning && (
            <OptionDropdown
              value={reasoningEffort}
              options={support.reasoning}
              defaultLabel={EFFORT_DEFAULT_LABEL}
              triggerClassName="w-[150px]"
              disabled={disabled}
              ariaLabel={`${config.name} reasoning effort`}
              onChange={onReasoningChange}
            />
          )}
        </div>
      }
    />
  );
}

const ModelsSettingsCard: React.FC = () => {
  const { getSelection, setModel, setReasoningEffort, loading, saving } = useAgentModelSettings();
  const disabled = loading || saving;

  return (
    <div className="flex flex-col gap-5">
      {MODEL_SELECTABLE_PROVIDER_IDS.map((providerId) => {
        const selection = getSelection(providerId);
        return (
          <ProviderModelRow
            key={providerId}
            providerId={providerId}
            disabled={disabled}
            model={selection.model}
            reasoningEffort={selection.reasoningEffort}
            onModelChange={(model) => setModel(providerId, model)}
            onReasoningChange={(effort) => setReasoningEffort(providerId, effort)}
          />
        );
      })}
    </div>
  );
};

export default ModelsSettingsCard;
