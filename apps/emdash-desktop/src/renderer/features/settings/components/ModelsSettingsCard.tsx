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
  getReasoningOptions,
  MODEL_SELECTABLE_PROVIDER_IDS,
  type AgentModelSelection,
} from '@shared/core/agents/agent-models';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import { useAgentModelSettings } from '../use-agent-model-settings';
import { SettingRow } from './SettingRow';

/** Sentinel used by the dropdowns to represent "fall back to the CLI default". */
const DEFAULT_OPTION_VALUE = '__default__';

/** Labels shown for the "fall back to the CLI default" option in each dropdown. */
const MODEL_DEFAULT_LABEL = 'Model Default';
const EFFORT_DEFAULT_LABEL = 'Effort Default';

type Option = { id: string; label: string; disabled?: boolean };

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
  /** Optional leading icon for an option id (skipped for the default option). */
  getOptionIcon?: (optionId: string) => React.ReactNode;
}

function OptionDropdown({
  value,
  options,
  defaultLabel,
  triggerClassName,
  disabled,
  ariaLabel,
  onChange,
  getOptionIcon,
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
        <span className="flex min-w-0 items-center gap-2">
          {getOptionIcon?.(selectedId)}
          <span className="truncate">{labelForOption(options, value, defaultLabel)}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-foreground-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-max">
        {allOptions.map((option) => (
          <DropdownMenuItem
            key={option.id}
            className="justify-between gap-4"
            disabled={option.disabled}
            onClick={() => {
              if (option.disabled) return;
              onChange(option.id === DEFAULT_OPTION_VALUE ? undefined : option.id);
            }}
          >
            <span className="flex min-w-0 items-center gap-2">
              {getOptionIcon?.(option.id)}
              <span className="truncate">{option.label}</span>
            </span>
            {option.id === selectedId && (
              <Check className="size-4 shrink-0 text-foreground-muted" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Resolve the brand whose logo represents a model option. Single-brand
 * providers (Codex/Claude/Amp) use their own logo; Cursor mixes vendors, so the
 * brand is derived from the model id prefix.
 */
function modelBrandKey(providerId: AgentProviderId, modelId: string): AgentProviderId | undefined {
  if (modelId === DEFAULT_OPTION_VALUE) return undefined;
  switch (providerId) {
    case 'codex':
      return 'codex';
    case 'claude':
      return 'claude';
    case 'amp':
      return 'amp';
    case 'cursor':
      if (modelId.startsWith('gpt')) return 'codex';
      if (modelId.startsWith('claude')) return 'claude';
      if (modelId.startsWith('gemini')) return 'gemini';
      if (modelId.startsWith('grok')) return 'grok';
      if (modelId.startsWith('kimi')) return 'kimi';
      if (modelId.startsWith('composer') || modelId === 'auto') return 'cursor';
      return undefined;
    default:
      return undefined;
  }
}

function ModelBrandIcon({
  providerId,
  modelId,
}: {
  providerId: AgentProviderId;
  modelId: string;
}): React.ReactNode {
  const key = modelBrandKey(providerId, modelId);
  if (!key) return null;
  const brand = agentConfig[key];
  return (
    <AgentLogo
      logo={brand.logo}
      logoDark={brand.logoDark}
      alt={brand.alt}
      isSvg={brand.isSvg}
      invertInDark={brand.invertInDark}
      className="h-4 w-4 shrink-0 rounded-sm"
    />
  );
}

interface ProviderModelRowProps {
  providerId: AgentProviderId;
  disabled: boolean;
  model: string | undefined;
  reasoningEffort: string | undefined;
  onSelectionChange: (patch: AgentModelSelection) => void;
}

function ProviderModelRow({
  providerId,
  disabled,
  model,
  reasoningEffort,
  onSelectionChange,
}: ProviderModelRowProps) {
  const support = getAgentModelSupport(providerId);
  const config = agentConfig[providerId];
  if (!support) return null;

  // Reasoning availability depends on the selected model (Cursor per family,
  // Amp rush vs smart/deep). The dropdown stays in place so the model and
  // reasoning columns line up across rows; it is disabled when the selected
  // model exposes no reasoning (e.g. Cursor on "Model Default").
  const reasoningOptions = getReasoningOptions(providerId, model);
  const reasoningDisabled = disabled || reasoningOptions.length === 0;

  const handleModelChange = (nextModel: string | undefined): void => {
    const nextReasoning = getReasoningOptions(providerId, nextModel);
    const keepEffort =
      reasoningEffort !== undefined &&
      nextReasoning.some((option) => option.id === reasoningEffort);
    onSelectionChange({
      model: nextModel,
      reasoningEffort: keepEffort ? reasoningEffort : undefined,
    });
  };

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
            onChange={handleModelChange}
            getOptionIcon={(optionId) => (
              <ModelBrandIcon providerId={providerId} modelId={optionId} />
            )}
          />
          <OptionDropdown
            value={reasoningEffort}
            options={reasoningOptions}
            defaultLabel={EFFORT_DEFAULT_LABEL}
            triggerClassName="w-[150px]"
            disabled={reasoningDisabled}
            ariaLabel={`${config.name} reasoning effort`}
            onChange={(effort) => onSelectionChange({ reasoningEffort: effort })}
          />
        </div>
      }
    />
  );
}

const ModelsSettingsCard: React.FC = () => {
  const { getSelection, setSelection, loading, saving } = useAgentModelSettings();
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
            onSelectionChange={(patch) => setSelection(providerId, patch)}
          />
        );
      })}
    </div>
  );
};

export default ModelsSettingsCard;
