import { ChevronDownIcon } from 'lucide-react';
import { useEffect } from 'react';
import { ResetToDefaultButton } from '@renderer/features/settings/components/ResetToDefaultButton';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import type { AgentModelOption } from '@shared/core/agents/agent-payload';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import type { AppSettings, AppSettingsKey } from '@shared/core/app-settings';

export type ModelDefaultKey = Extract<AppSettingsKey, 'defaultModel' | 'defaultAutomationModel'>;
type ModelDefaultValue = AppSettings[ModelDefaultKey];

export function DefaultModelSelect({
  agentId,
  modelSettingKey,
  modelOptions,
  disabled = false,
  className,
}: {
  agentId: AgentProviderId;
  modelSettingKey: ModelDefaultKey;
  modelOptions: Record<string, AgentModelOption> | null;
  disabled?: boolean;
  className?: string;
}) {
  const {
    value: defaultModelValue,
    update,
    reset,
    isLoading,
    isSaving,
    isOverridden,
  } = useAppSettingsKey(modelSettingKey);

  const defaultModel =
    typeof defaultModelValue === 'string' && modelOptions && defaultModelValue in modelOptions
      ? defaultModelValue
      : null;

  useEffect(() => {
    if (
      modelOptions &&
      typeof defaultModelValue === 'string' &&
      !(defaultModelValue in modelOptions)
    ) {
      update(null as ModelDefaultValue);
    }
  }, [defaultModelValue, modelOptions, update]);

  if (!modelOptions) {
    return (
      <div className={cn('flex min-w-0 items-center gap-1', className)}>
        <span aria-hidden="true" className="h-7 w-7 shrink-0" />
        <TooltipProvider delay={150}>
          <Tooltip>
            <TooltipTrigger>
              <div
                aria-disabled="true"
                className="flex h-8 w-44 cursor-not-allowed items-center justify-between gap-1.5 rounded-md border border-border bg-transparent px-2.5 py-1 text-sm text-foreground-muted opacity-50 outline-none"
              >
                <span className="truncate">Default model</span>
                <ChevronDownIcon className="size-4 shrink-0" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top">This agent does not support model selection.</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-1', className)}>
      <ResetToDefaultButton
        visible={isOverridden}
        defaultLabel="Default model"
        onReset={reset}
        disabled={disabled || isLoading || isSaving}
      />
      <Select
        value={defaultModel ?? ''}
        onValueChange={(val) => update((val || null) as ModelDefaultValue)}
        disabled={disabled || isLoading || isSaving}
      >
        <SelectTrigger className="w-44">
          <SelectValue placeholder="Default model">
            {defaultModel ? (modelOptions[defaultModel]?.name ?? defaultModel) : 'Default model'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="min-w-44">
          <SelectItem value="">Default model</SelectItem>
          {Object.entries(modelOptions).map(([id, opt]) => (
            <SelectItem key={`${agentId}:${id}`} value={id}>
              {opt.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
