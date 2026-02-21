import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X, RotateCcw, Info, Plus, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { PROVIDERS, type ProviderDefinition } from '@shared/providers/registry';
import type { ProviderCustomConfig } from '../types/electron-api';

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

const getDefaultFromProvider = (provider: ProviderDefinition | undefined): FormState => ({
  cli: provider?.cli ?? '',
  resumeFlag: provider?.resumeFlag ?? '',
  defaultArgs: provider?.defaultArgs?.join(' ') ?? '',
  extraArgs: '',
  autoApproveFlag: provider?.autoApproveFlag ?? '',
  initialPromptFlag: provider?.initialPromptFlag ?? '',
  envEntries: [],
});

const CustomCommandModal: React.FC<CustomCommandModalProps> = ({ isOpen, onClose, providerId }) => {
  const shouldReduceMotion = useReducedMotion();
  const provider = useMemo(() => PROVIDERS.find((p) => p.id === providerId), [providerId]);

  const defaults = useMemo(() => getDefaultFromProvider(provider), [provider]);

  const [form, setForm] = useState<FormState>(defaults);
  const [hasCustomConfig, setHasCustomConfig] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Load existing custom config
  useEffect(() => {
    if (!isOpen || !providerId) return;

    const loadConfig = async () => {
      setLoading(true);
      try {
        const result = await window.electronAPI.getProviderCustomConfig?.(providerId);
        if (result?.success && result.config) {
          const env = result.config.env;
          const envEntries: EnvEntry[] =
            env && typeof env === 'object'
              ? Object.entries(env).map(([key, value]) => ({ key, value: String(value) }))
              : [];
          setForm({
            cli: result.config.cli ?? defaults.cli,
            resumeFlag: result.config.resumeFlag ?? defaults.resumeFlag,
            defaultArgs: result.config.defaultArgs ?? defaults.defaultArgs,
            extraArgs: result.config.extraArgs ?? '',
            autoApproveFlag: result.config.autoApproveFlag ?? defaults.autoApproveFlag,
            initialPromptFlag: result.config.initialPromptFlag ?? defaults.initialPromptFlag,
            envEntries,
          });
          setHasCustomConfig(true);
        } else {
          setForm(defaults);
          setHasCustomConfig(false);
        }
      } catch (error) {
        console.error('Failed to load provider custom config:', error);
        setForm(defaults);
        setHasCustomConfig(false);
      } finally {
        setLoading(false);
      }
    };

    void loadConfig();
  }, [isOpen, providerId, defaults]);

  const handleChange = useCallback((field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const setEnvEntry = useCallback((index: number, update: Partial<EnvEntry>) => {
    setForm((prev) => {
      const next = [...prev.envEntries];
      next[index] = { ...next[index], ...update };
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
    setForm(defaults);
  }, [defaults]);

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

      const isDefault =
        form.cli === defaults.cli &&
        form.resumeFlag === defaults.resumeFlag &&
        form.defaultArgs === defaults.defaultArgs &&
        form.extraArgs === '' &&
        form.autoApproveFlag === defaults.autoApproveFlag &&
        form.initialPromptFlag === defaults.initialPromptFlag &&
        form.envEntries.every((e) => !e.key.trim());

      if (isDefault) {
        await window.electronAPI.updateProviderCustomConfig?.(providerId, undefined);
        setHasCustomConfig(false);
      } else {
        const config: ProviderCustomConfig = {
          cli: form.cli,
          resumeFlag: form.resumeFlag,
          defaultArgs: form.defaultArgs,
          extraArgs: form.extraArgs.trim() || undefined,
          autoApproveFlag: form.autoApproveFlag,
          initialPromptFlag: form.initialPromptFlag,
          env: Object.keys(envRecord).length > 0 ? envRecord : undefined,
        };
        await window.electronAPI.updateProviderCustomConfig?.(providerId, config);
        setHasCustomConfig(true);
      }
      onClose();
    } catch (error) {
      console.error('Failed to save provider custom config:', error);
    } finally {
      setSaving(false);
    }
  }, [form, defaults, providerId, onClose]);

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
    if (hasCustomConfig) return true;
    const hasEnv = form.envEntries.some((e) => e.key.trim() !== '');
    return (
      form.cli !== defaults.cli ||
      form.resumeFlag !== defaults.resumeFlag ||
      form.defaultArgs !== defaults.defaultArgs ||
      form.extraArgs !== '' ||
      form.autoApproveFlag !== defaults.autoApproveFlag ||
      form.initialPromptFlag !== defaults.initialPromptFlag ||
      hasEnv
    );
  }, [form, defaults, hasCustomConfig]);

  if (!provider) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="custom-command-title"
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.12, ease: 'easeOut' }}
          onClick={onClose}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={shouldReduceMotion ? false : { opacity: 0, y: 8, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              shouldReduceMotion
                ? { opacity: 1, y: 0, scale: 1 }
                : { opacity: 0, y: 6, scale: 0.995 }
            }
            transition={
              shouldReduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }
            }
            className="mx-4 w-full max-w-lg overflow-hidden rounded-2xl border border-border/50 bg-background shadow-2xl"
          >
            {/* Header */}
            <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
              <div>
                <h2 id="custom-command-title" className="text-lg font-semibold">
                  {provider.name} Execution Settings
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Customize the agent execution command
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-8 w-8"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </header>

            {/* Body */}
            <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
              {loading ? (
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
                      placeholder={defaults.cli || 'CLI command'}
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
                      placeholder={defaults.resumeFlag || '(none)'}
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
                      placeholder={defaults.defaultArgs || '(none)'}
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
                            className="h-8 w-8 flex-shrink-0"
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
                      placeholder={defaults.autoApproveFlag || '(none)'}
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
                      placeholder={defaults.initialPromptFlag || '(pass directly)'}
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

                  {hasCustomConfig && (
                    <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-600 dark:text-yellow-400">
                      Custom configuration is applied
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <footer className="flex items-center justify-between border-t border-border/60 px-6 py-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleResetToDefaults}
                disabled={loading || saving}
                className="gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset to Defaults
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onClose}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSave}
                  disabled={loading || saving || !hasChanges}
                >
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

const FieldTooltip: React.FC<{ content: string }> = ({ content }) => (
  <TooltipProvider>
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
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
