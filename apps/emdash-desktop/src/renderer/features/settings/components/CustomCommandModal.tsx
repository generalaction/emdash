import { Info, Plus, RotateCcw, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useProviderSettings } from '@renderer/features/settings/use-provider-settings';
import { parseEnvAssignmentPaste, replaceEnvEntryWithPaste } from '@renderer/lib/env-paste';
import { agentMeta } from '@renderer/lib/providers/meta';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { log } from '@renderer/utils/logger';
import type { ProviderCustomConfig } from '@shared/core/app-settings';

interface CustomCommandModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
}

type EnvEntry = { key: string; value: string };

type FormState = {
  cli: string;
  extraArgs: string;
  envEntries: EnvEntry[];
};

const configToFormState = (config: ProviderCustomConfig, defaultCli: string): FormState => ({
  cli: config.cli ?? defaultCli,
  extraArgs: config.extraArgs ?? '',
  envEntries: config.env ? Object.entries(config.env).map(([key, value]) => ({ key, value })) : [],
});

const CustomCommandModal: React.FC<CustomCommandModalProps> = ({ isOpen, onClose, providerId }) => {
  const meta = agentMeta[providerId as keyof typeof agentMeta];

  const {
    value: storedConfig,
    defaults: storedDefaults,
    isOverridden,
    isLoading,
    update,
    reset,
  } = useProviderSettings(providerId);

  // Default CLI comes from server-side defaults (capabilities.install.binaryNames[0]).
  const defaultCli = storedDefaults?.cli ?? providerId;
  const defaultFormState = useMemo<FormState>(
    () => ({ cli: defaultCli, extraArgs: '', envEntries: [] }),
    [defaultCli]
  );

  const [form, setForm] = useState<FormState>(defaultFormState);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || isLoading) return;
    if (storedConfig && isOverridden) {
      setForm(configToFormState(storedConfig, defaultCli));
    } else {
      setForm(defaultFormState);
    }
  }, [isOpen, isLoading, storedConfig, isOverridden, defaultFormState, defaultCli]);

  const handleChange = useCallback((field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

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

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const envRecord: Record<string, string> = {};
      for (const { key, value } of form.envEntries) {
        const k = key.trim();
        if (k && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
          envRecord[k] = value;
        }
      }

      const isAtDefaults =
        form.cli === defaultCli &&
        form.extraArgs === '' &&
        form.envEntries.every((e) => !e.key.trim());

      if (isAtDefaults) {
        await new Promise<void>((resolve, reject) =>
          reset(undefined, { onSuccess: resolve, onError: reject })
        );
      } else {
        const config: ProviderCustomConfig = {
          cli: form.cli,
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
  }, [form, defaultCli, reset, update, onClose]);

  const previewCommand = useMemo(() => {
    const parts: string[] = [];
    if (form.cli) parts.push(form.cli);
    if (form.extraArgs) parts.push(form.extraArgs);
    parts.push('{prompt}');
    return parts.join(' ');
  }, [form]);

  const hasChanges = useMemo(() => {
    if (isOverridden) return true;
    const hasEnv = form.envEntries.some((e) => e.key.trim() !== '');
    return form.cli !== defaultCli || form.extraArgs !== '' || hasEnv;
  }, [form, defaultCli, isOverridden]);

  const providerName = meta?.label ?? providerId;
  if (!meta) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[85vh] max-w-lg gap-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        <div className="border-b border-border/60">
          <DialogHeader className="flex-row items-start gap-4">
            <div>
              <DialogTitle className="text-lg font-semibold">
                {providerName} Execution Settings
              </DialogTitle>
            </div>
          </DialogHeader>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground text-sm">Loading...</div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* CLI Command */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="cli" className="text-sm font-medium">
                    CLI Command
                  </Label>
                  <FieldTooltip content="The CLI command to execute (e.g., claude, codex)" />
                </div>
                <Input
                  id="cli"
                  value={form.cli}
                  onChange={(e) => handleChange('cli', e.target.value)}
                  placeholder={defaultCli || 'CLI command'}
                  className="font-mono text-sm"
                />
              </div>

              {/* Additional parameters */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="extraArgs" className="text-sm font-medium">
                    Additional parameters
                  </Label>
                  <FieldTooltip content="Extra flags appended to the command (e.g. --enable-all-github-mcp-tools)" />
                </div>
                <Input
                  id="extraArgs"
                  value={form.extraArgs}
                  onChange={(e) => handleChange('extraArgs', e.target.value)}
                  placeholder="e.g. --enable-all-github-mcp-tools"
                  className="font-mono text-sm"
                />
              </div>

              {/* Environment variables */}
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

              {/* Preview */}
              <div className="bg-muted/30 mt-6 rounded-lg border border-border/60 p-4">
                <div className="text-muted-foreground mb-2 text-xs font-medium">
                  Command Preview
                </div>
                <code className="block font-mono text-sm break-all text-foreground">
                  {previewCommand}
                </code>
              </div>

              {isOverridden && (
                <div className="rounded-md border border-border-warning bg-background-warning px-3 py-2 text-xs text-foreground-warning">
                  Custom configuration is applied
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border/60 px-6 py-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleResetToDefaults}
            disabled={isLoading || saving}
            className="gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to Defaults
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <ConfirmButton
              type="button"
              size="sm"
              onClick={() => void handleSave()}
              disabled={isLoading || saving || !hasChanges}
            >
              {saving ? 'Saving...' : 'Save'}
            </ConfirmButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
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

export default CustomCommandModal;
