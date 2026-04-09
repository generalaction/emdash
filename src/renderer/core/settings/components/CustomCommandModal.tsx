import { Info, Plus, RotateCcw, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AGENT_PROVIDERS, type AgentProviderDefinition } from '@shared/agent-provider-registry';
import type { ProviderCustomConfig } from '@shared/app-settings';
import { log } from '@renderer/lib/logger';
import { Button } from '../../../components/ui/button';
import { ConfirmButton } from '../../../components/ui/confirm-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../components/ui/tooltip';
import { useProviderSettings } from '../use-provider-settings';

interface CustomCommandModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
}

type EnvEntry = { key: string; value: string };

type FormState = {
  cli: string;
  resumeFlag: string;
  defaultArgs: string;
  extraArgs: string;
  autoApproveFlag: string;
  initialPromptFlag: string;
  envEntries: EnvEntry[];
};

const getDefaultFromProvider = (provider: AgentProviderDefinition | undefined): FormState => ({
  cli: provider?.cli ?? '',
  resumeFlag: provider?.resumeFlag ?? '',
  defaultArgs: provider?.defaultArgs?.join(' ') ?? '',
  extraArgs: '',
  autoApproveFlag: provider?.autoApproveFlag ?? '',
  initialPromptFlag: provider?.initialPromptFlag ?? '',
  envEntries: [],
});

const configToFormState = (config: ProviderCustomConfig, fallback: FormState): FormState => ({
  cli: config.cli ?? fallback.cli,
  resumeFlag: config.resumeFlag ?? fallback.resumeFlag,
  defaultArgs: Array.isArray(config.defaultArgs)
    ? config.defaultArgs.join(' ')
    : (config.defaultArgs ?? fallback.defaultArgs),
  extraArgs: config.extraArgs ?? '',
  autoApproveFlag: config.autoApproveFlag ?? fallback.autoApproveFlag,
  initialPromptFlag: config.initialPromptFlag ?? fallback.initialPromptFlag,
  envEntries: config.env ? Object.entries(config.env).map(([key, value]) => ({ key, value })) : [],
});

const CustomCommandModal: React.FC<CustomCommandModalProps> = ({ isOpen, onClose, providerId }) => {
  const provider = useMemo(() => AGENT_PROVIDERS.find((p) => p.id === providerId), [providerId]);
  const registryDefaults = useMemo(() => getDefaultFromProvider(provider), [provider]);

  const {
    value: storedConfig,
    isOverridden,
    isLoading,
    update,
    reset,
  } = useProviderSettings(providerId);

  const [form, setForm] = useState<FormState>(registryDefaults);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || isLoading) return;
    if (storedConfig && isOverridden) {
      setForm(configToFormState(storedConfig, registryDefaults));
    } else {
      setForm(registryDefaults);
    }
  }, [isOpen, isLoading, storedConfig, isOverridden, registryDefaults]);

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

  const handleResetToDefaults = useCallback(() => {
    setForm(registryDefaults);
  }, [registryDefaults]);

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
        form.cli === registryDefaults.cli &&
        form.resumeFlag === registryDefaults.resumeFlag &&
        form.defaultArgs === registryDefaults.defaultArgs &&
        form.extraArgs === '' &&
        form.autoApproveFlag === registryDefaults.autoApproveFlag &&
        form.initialPromptFlag === registryDefaults.initialPromptFlag &&
        form.envEntries.every((e) => !e.key.trim());

      if (isAtDefaults) {
        await new Promise<void>((resolve, reject) =>
          reset(undefined, { onSuccess: resolve, onError: reject })
        );
      } else {
        const config: ProviderCustomConfig = {
          cli: form.cli,
          resumeFlag: form.resumeFlag,
          defaultArgs: form.defaultArgs.trim() ? form.defaultArgs.trim().split(/\s+/) : undefined,
          extraArgs: form.extraArgs.trim() || undefined,
          autoApproveFlag: form.autoApproveFlag,
          initialPromptFlag: form.initialPromptFlag,
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
  }, [form, registryDefaults, reset, update, onClose]);

  const previewCommand = useMemo(() => {
    const parts: string[] = [];
    if (form.cli) parts.push(form.cli);
    if (form.resumeFlag) parts.push(form.resumeFlag);
    if (form.defaultArgs) parts.push(form.defaultArgs);
    if (form.extraArgs) parts.push(form.extraArgs);
    if (form.autoApproveFlag) parts.push(form.autoApproveFlag);
    if (form.initialPromptFlag) parts.push(form.initialPromptFlag);
    parts.push('{prompt}');
    return parts.join(' ');
  }, [form]);

  const hasChanges = useMemo(() => {
    if (isOverridden) return true;
    const hasEnv = form.envEntries.some((e) => e.key.trim() !== '');
    return (
      form.cli !== registryDefaults.cli ||
      form.resumeFlag !== registryDefaults.resumeFlag ||
      form.defaultArgs !== registryDefaults.defaultArgs ||
      form.extraArgs !== '' ||
      form.autoApproveFlag !== registryDefaults.autoApproveFlag ||
      form.initialPromptFlag !== registryDefaults.initialPromptFlag ||
      hasEnv
    );
  }, [form, registryDefaults, isOverridden]);

  if (!provider) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="p-0 gap-0 overflow-hidden max-w-lg" showCloseButton={false}>
        <DialogHeader className="flex-row items-start justify-between border-b border-border/60 px-6 py-4 gap-4">
          <div>
            <DialogTitle className="text-lg font-semibold">
              {provider.name} Execution Settings
            </DialogTitle>
            <DialogDescription className="mt-0.5">
              Customize the agent execution command
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-sm text-muted-foreground">Loading...</div>
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
                  placeholder={registryDefaults.cli || 'CLI command'}
                  className="font-mono text-sm"
                />
              </div>

              {/* Resume Flag */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="resumeFlag" className="text-sm font-medium">
                    Resume Flag
                  </Label>
                  <FieldTooltip content="Flag used when resuming a session (e.g., -c -r)" />
                </div>
                <Input
                  id="resumeFlag"
                  value={form.resumeFlag}
                  onChange={(e) => handleChange('resumeFlag', e.target.value)}
                  placeholder={registryDefaults.resumeFlag || '(none)'}
                  className="font-mono text-sm"
                />
              </div>

              {/* Default Args */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="defaultArgs" className="text-sm font-medium">
                    Default Args
                  </Label>
                  <FieldTooltip content="Default arguments (e.g., run -s)" />
                </div>
                <Input
                  id="defaultArgs"
                  value={form.defaultArgs}
                  onChange={(e) => handleChange('defaultArgs', e.target.value)}
                  placeholder={registryDefaults.defaultArgs || '(none)'}
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

              {/* Auto-approve Flag */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="autoApproveFlag" className="text-sm font-medium">
                    Auto-approve Flag
                  </Label>
                  <FieldTooltip content="Flag used in auto-approve mode" />
                </div>
                <Input
                  id="autoApproveFlag"
                  value={form.autoApproveFlag}
                  onChange={(e) => handleChange('autoApproveFlag', e.target.value)}
                  placeholder={registryDefaults.autoApproveFlag || '(none)'}
                  className="font-mono text-sm"
                />
              </div>

              {/* Initial Prompt Flag */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="initialPromptFlag" className="text-sm font-medium">
                    Initial Prompt Flag
                  </Label>
                  <FieldTooltip content="Flag for passing initial prompt (empty means pass directly)" />
                </div>
                <Input
                  id="initialPromptFlag"
                  value={form.initialPromptFlag}
                  onChange={(e) => handleChange('initialPromptFlag', e.target.value)}
                  placeholder={registryDefaults.initialPromptFlag || '(pass directly)'}
                  className="font-mono text-sm"
                />
              </div>

              {/* Preview */}
              <div className="mt-6 rounded-lg border border-border/60 bg-muted/30 p-4">
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  Command Preview
                </div>
                <code className="block break-all font-mono text-sm text-foreground">
                  {previewCommand}
                </code>
              </div>

              {isOverridden && (
                <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-600 dark:text-yellow-400">
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
