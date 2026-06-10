import { metadataRegistry } from '@emdash/cli-agent-plugins/metadata';
import { Info, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useProviderSettings } from '@renderer/features/settings/use-provider-settings';
import { parseEnvAssignmentPaste, replaceEnvEntryWithPaste } from '@renderer/lib/env-paste';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
} from '@renderer/lib/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { log } from '@renderer/utils/logger';
import type { ProviderCustomConfig } from '@shared/core/app-settings';
import type { UseInstallationPayload } from './InstallSection';
import { InstallSection } from './InstallSection';
import { AgentSheetHeaderSection } from './AgentSheetHeaderSection';

interface AgentDetailSheetProps {
  agentId: string | null;
  onClose: () => void;
}

type EnvEntry = { key: string; value: string };

type FormState = {
  extraArgs: string;
  envEntries: EnvEntry[];
};

const configToFormState = (config: ProviderCustomConfig): FormState => ({
  extraArgs: config.extraArgs ?? '',
  envEntries: config.env ? Object.entries(config.env).map(([key, value]) => ({ key, value })) : [],
});

const AgentDetailSheetContent = observer(function AgentDetailSheetContent({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}) {
  const meta = metadataRegistry.get(agentId);
  const agentPayload = appState.dependencies.agents.data?.find((a) => a.id === agentId);

  const {
    value: storedConfig,
    isOverridden,
    isLoading,
    update,
    reset,
  } = useProviderSettings(agentId);

  const defaultFormState = useMemo<FormState>(() => ({ extraArgs: '', envEntries: [] }), []);

  const [form, setForm] = useState<FormState>(defaultFormState);
  const [saving, setSaving] = useState(false);

  const installOptions = useMemo(
    () => agentPayload?.installOptions ?? [],
    [agentPayload?.installOptions]
  );

  useEffect(() => {
    if (isLoading) return;
    if (storedConfig && isOverridden) {
      setForm(configToFormState(storedConfig));
    } else {
      setForm(defaultFormState);
    }
  }, [isLoading, storedConfig, isOverridden, defaultFormState]);

  const setEnvEntry = useCallback((index: number, entryUpdate: Partial<EnvEntry>) => {
    setForm((prev) => {
      const next = [...prev.envEntries];
      next[index] = { ...next[index], ...entryUpdate };
      return { ...prev, envEntries: next };
    });
  }, []);

  const addEnvEntry = useCallback(() => {
    setForm((prev) => ({ ...prev, envEntries: [...prev.envEntries, { key: '', value: '' }] }));
  }, []);

  const removeEnvEntry = useCallback((index: number) => {
    setForm((prev) => ({
      ...prev,
      envEntries: prev.envEntries.filter((_, i) => i !== index),
    }));
  }, []);

  const handleEnvPaste = useCallback((index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = parseEnvAssignmentPaste(e.clipboardData.getData('text'));
    if (pasted.length === 0) return;
    e.preventDefault();
    setForm((prev) => ({
      ...prev,
      envEntries: replaceEnvEntryWithPaste(prev.envEntries, index, pasted),
    }));
  }, []);

  const handleResetToDefaults = useCallback(() => {
    setForm(defaultFormState);
  }, [defaultFormState]);

  const handleUseInstallation = useCallback(
    (payload: UseInstallationPayload) => {
      const current = storedConfig ?? {};
      const merged: ProviderCustomConfig = {
        ...current,
        installSource: payload.installSource,
        path: payload.path !== undefined ? payload.path : current.path,
        cli: payload.cli !== undefined ? payload.cli : current.cli,
      };
      update(merged, {
        onError: (err) => log.error('Failed to save install source:', err),
      });
    },
    [storedConfig, update]
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const envRecord: Record<string, string> = {};
      for (const { key, value } of form.envEntries) {
        const k = key.trim();
        if (k && /^[A-Za-z_]\w*$/.test(k)) {
          envRecord[k] = value;
        }
      }

      const isAtDefaults = form.extraArgs === '' && form.envEntries.every((e) => !e.key.trim());

      if (
        isAtDefaults &&
        !storedConfig?.installSource &&
        !storedConfig?.path &&
        !storedConfig?.cli
      ) {
        await new Promise<void>((resolve, reject) =>
          reset(undefined, { onSuccess: resolve, onError: reject })
        );
      } else {
        const config: ProviderCustomConfig = {
          ...(storedConfig ?? {}),
          extraArgs: form.extraArgs.trim() || undefined,
          env: Object.keys(envRecord).length > 0 ? envRecord : undefined,
        };
        await new Promise<void>((resolve, reject) =>
          update(config, { onSuccess: resolve, onError: reject })
        );
      }
      onClose();
    } catch (error) {
      log.error('Failed to save provider custom config:', error);
    } finally {
      setSaving(false);
    }
  }, [form, storedConfig, reset, update, onClose]);

  const hasChanges = useMemo(() => {
    if (isOverridden) return true;
    const hasEnv = form.envEntries.some((e) => e.key.trim() !== '');
    return form.extraArgs !== '' || hasEnv;
  }, [form, isOverridden]);

  const providerName = meta?.name ?? agentId;
  const isInstalled = agentPayload?.status === 'available';
  const updateAvailable = agentPayload?.updateAvailable ?? false;

  return (
    <>
      <SheetHeader label={isInstalled ? 'Agent Settings' : 'Install Agent'} />

      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <div className="space-y-6">
          {agentPayload && <AgentSheetHeaderSection agent={agentPayload} />}
          {/* Install section — always visible */}
          <InstallSection
            agentId={agentId}
            installOptions={installOptions}
            installDocs={agentPayload?.installDocs ?? null}
            isInstalled={isInstalled}
            updateAvailable={updateAvailable}
            installSource={storedConfig?.installSource}
            pathValue={storedConfig?.path}
            cliValue={storedConfig?.cli}
            onUseInstallation={handleUseInstallation}
          />

          {/* Execution settings — only when installed */}
          {isInstalled &&
            (isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-muted-foreground text-sm">Loading...</div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="border-t border-border/60 pt-4">
                  <Label className="text-sm font-medium">Execution Settings</Label>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="sheet-extraArgs" className="text-sm font-medium">
                      Additional parameters
                    </Label>
                    <FieldTooltip content="Extra flags appended to the command (e.g. --enable-all-github-mcp-tools)" />
                  </div>
                  <Input
                    id="sheet-extraArgs"
                    value={form.extraArgs}
                    onChange={(e) => setForm((prev) => ({ ...prev, extraArgs: e.target.value }))}
                    placeholder="e.g. --enable-all-github-mcp-tools"
                    className="font-mono text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm font-medium">Environment variables</Label>
                    <FieldTooltip content="Environment variables set when running the agent" />
                  </div>
                  <div className="space-y-2">
                    {form.envEntries.map((entry, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          value={entry.key}
                          onChange={(e) => setEnvEntry(i, { key: e.target.value })}
                          placeholder="KEY"
                          className="min-w-0 flex-1 font-mono text-sm"
                          onPaste={(e) => handleEnvPaste(i, e)}
                        />
                        <Input
                          value={entry.value}
                          onChange={(e) => setEnvEntry(i, { value: e.target.value })}
                          placeholder="value"
                          className="min-w-0 flex-1 font-mono text-sm"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeEnvEntry(i)}
                          className="h-8 w-8 shrink-0"
                          aria-label="Remove"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addEnvEntry}
                      className="gap-1.5"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add variable
                    </Button>
                  </div>
                </div>

                {isOverridden && (
                  <div className="rounded-md border border-border-warning bg-background-warning px-3 py-2 text-xs text-foreground-warning">
                    Custom configuration is applied
                  </div>
                )}
              </div>
            ))}
        </div>
      </div>

      <SheetFooter>
        {isInstalled && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleResetToDefaults}
            disabled={isLoading || saving}
            className="mr-auto gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to Defaults
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
          {isInstalled ? 'Cancel' : 'Close'}
        </Button>
        {isInstalled && (
          <ConfirmButton
            type="button"
            size="sm"
            onClick={() => void handleSave()}
            disabled={isLoading || saving || !hasChanges}
          >
            {saving ? 'Saving...' : 'Save'}
          </ConfirmButton>
        )}
      </SheetFooter>
    </>
  );
});

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

export function AgentDetailSheet({ agentId, onClose }: AgentDetailSheetProps) {
  return (
    <Sheet open={agentId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0">
        {agentId && <AgentDetailSheetContent agentId={agentId} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}
