import { useForm } from '@tanstack/react-form';
import { ChevronRight, Info, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useEffect, useState } from 'react';
import { parseEnvAssignmentPaste, replaceEnvEntryWithPaste } from '@renderer/lib/env-paste';
import { Button } from '@renderer/lib/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/lib/ui/collapsible';
import { Field } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { log } from '@renderer/utils/logger';
import { cn } from '@renderer/utils/utils';
import type { ProviderCustomConfig } from '@shared/core/app-settings';

type EnvEntry = { key: string; value: string };

type AgentSettingsFormValues = {
  extraArgs: string;
  envEntries: EnvEntry[];
};

const FieldTooltip: React.FC<{ content: string }> = ({ content }) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          aria-label="More information"
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[200px] text-xs">
        {content}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export interface InstalledAgentContentProps {
  storedConfig: ProviderCustomConfig | undefined;
  isOverridden: boolean;
  isLoading: boolean;
  update: (
    cfg: ProviderCustomConfig,
    opts?: { onSuccess?: () => void; onError?: (e: unknown) => void }
  ) => void;
  reset: (
    val?: undefined,
    opts?: { onSuccess?: () => void; onError?: (e: unknown) => void }
  ) => void;
}

function makeDefaultValues(cfg: ProviderCustomConfig | undefined): AgentSettingsFormValues {
  return {
    extraArgs: cfg?.extraArgs ?? '',
    envEntries: cfg?.env
      ? (Object.entries(cfg.env).map(([key, value]) => ({ key, value })) as EnvEntry[])
      : ([] as EnvEntry[]),
  };
}

export const InstalledAgentContent = observer(function InstalledAgentContent({
  storedConfig,
  isOverridden,
  isLoading,
  update,
  reset,
}: InstalledAgentContentProps) {
  const [open, setOpen] = useState(false);

  const form = useForm({ defaultValues: makeDefaultValues(storedConfig) });

  // Re-sync form when external config changes (e.g. after a reset from outside).
  useEffect(() => {
    if (isLoading) return;
    if (form.state.isDirty) return;
    const next = makeDefaultValues(storedConfig);
    form.setFieldValue('extraArgs', next.extraArgs);
    form.setFieldValue('envEntries', next.envEntries);
  }, [isLoading, storedConfig, isOverridden, form]);

  const commit = useCallback(
    (values: AgentSettingsFormValues = form.state.values) => {
      const { extraArgs, envEntries } = values;
      const envRecord: Record<string, string> = {};
      for (const { key, value } of envEntries) {
        const k = key.trim();
        if (k && /^[A-Za-z_]\w*$/.test(k)) {
          envRecord[k] = value;
        }
      }

      const isAtDefaults = extraArgs.trim() === '' && envEntries.every((e) => !e.key.trim());

      if (isAtDefaults) {
        reset(undefined, {
          onError: (err) => log.error('Failed to reset agent config:', err),
        });
      } else {
        const config: ProviderCustomConfig = {
          ...(storedConfig ?? {}),
          extraArgs: extraArgs.trim() || undefined,
          env: Object.keys(envRecord).length > 0 ? envRecord : undefined,
        };
        update(config, {
          onError: (err) => log.error('Failed to save agent config:', err),
        });
      }
    },
    [form, storedConfig, reset, update]
  );

  const handleResetToDefaults = useCallback(() => {
    form.setFieldValue('extraArgs', '');
    form.setFieldValue('envEntries', []);
    reset(undefined, {
      onError: (err) => log.error('Failed to reset agent config:', err),
    });
  }, [form, reset]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          type="button"
          className="flex w-full items-center justify-between rounded-md py-2 text-sm font-medium text-foreground-muted hover:text-foreground"
        >
          <span className="flex h-6 items-center gap-1.5">
            <Label>Advanced settings</Label>
            <ChevronRight
              className={cn('size-3.5', 'transition-transform', open ? 'rotate-90' : '')}
            />
          </span>
          {isOverridden && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1.5 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                handleResetToDefaults();
              }}
            >
              <RotateCcw className="size-3.5" />
              Reset to defaults
            </Button>
          )}
        </CollapsibleTrigger>

        <CollapsibleContent className="space-y-4 rounded-lg border p-3">
          {/* Additional parameters */}
          <form.Field name="extraArgs">
            {(field) => (
              <Field>
                <div className="flex items-center gap-2">
                  <Label htmlFor="sheet-extraArgs">Additional parameters</Label>
                  <FieldTooltip content="Extra flags appended to the command (e.g. --enable-all-github-mcp-tools)" />
                </div>
                <Input
                  id="sheet-extraArgs"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={() => commit({ ...form.state.values, extraArgs: field.state.value })}
                  placeholder="e.g. --enable-all-github-mcp-tools"
                  className="font-mono text-sm"
                />
              </Field>
            )}
          </form.Field>

          {/* Environment variables */}
          <form.Field name="envEntries">
            {(field) => (
              <Field>
                <div className="flex items-center gap-2">
                  <Label>Environment variables</Label>
                  <FieldTooltip content="Environment variables set when running the agent" />
                </div>
                <div className="space-y-2">
                  {field.state.value.map((entry, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={entry.key}
                        placeholder="KEY"
                        className="min-w-0 flex-1 font-mono text-sm"
                        onChange={(e) => {
                          const next = field.state.value.map((v, idx) =>
                            idx === i ? { ...v, key: e.target.value } : v
                          );
                          field.handleChange(next);
                        }}
                        onBlur={() =>
                          commit({ ...form.state.values, envEntries: field.state.value })
                        }
                        onPaste={(e) => {
                          const pasted = parseEnvAssignmentPaste(e.clipboardData.getData('text'));
                          if (pasted.length === 0) return;
                          e.preventDefault();
                          const next = replaceEnvEntryWithPaste(field.state.value, i, pasted);
                          field.handleChange(next);
                          commit({ ...form.state.values, envEntries: next });
                        }}
                      />
                      <Input
                        value={entry.value}
                        placeholder="value"
                        className="min-w-0 flex-1 font-mono text-sm"
                        onChange={(e) => {
                          const next = field.state.value.map((v, idx) =>
                            idx === i ? { ...v, value: e.target.value } : v
                          );
                          field.handleChange(next);
                        }}
                        onBlur={() =>
                          commit({ ...form.state.values, envEntries: field.state.value })
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        aria-label="Remove"
                        onClick={() => {
                          const next = field.state.value.filter((_, idx) => idx !== i);
                          field.handleChange(next);
                          commit({ ...form.state.values, envEntries: next });
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() =>
                      field.handleChange([...field.state.value, { key: '', value: '' }])
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add variable
                  </Button>
                </div>
              </Field>
            )}
          </form.Field>

          {isOverridden && (
            <div className="rounded-md border border-border-warning bg-background-warning px-3 py-2 text-xs text-foreground-warning">
              Custom configuration is applied
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
});
