import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Info, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { PROVIDERS, type ProviderDefinition, type ProviderId } from '@shared/providers/registry';
import type { ProviderCustomConfig } from '@shared/providers/customConfig';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

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

type ProviderPresetMap = Partial<Record<ProviderId, ProviderCustomConfig>>;
type ProviderFormMap = Partial<Record<ProviderId, FormState>>;

interface TaskAgentPresetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  agentIds: ProviderId[];
  value: ProviderPresetMap;
  onSave: (nextValue: ProviderPresetMap) => void;
}

const getProviderById = (providerId: ProviderId): ProviderDefinition | undefined =>
  PROVIDERS.find((provider) => provider.id === providerId);

const getDefaultForm = (
  provider: ProviderDefinition | undefined,
  globalConfig?: ProviderCustomConfig
): FormState => ({
  cli: globalConfig?.cli ?? provider?.cli ?? '',
  resumeFlag: globalConfig?.resumeFlag ?? provider?.resumeFlag ?? '',
  defaultArgs: globalConfig?.defaultArgs ?? provider?.defaultArgs?.join(' ') ?? '',
  extraArgs: globalConfig?.extraArgs ?? '',
  autoApproveFlag: globalConfig?.autoApproveFlag ?? provider?.autoApproveFlag ?? '',
  initialPromptFlag: globalConfig?.initialPromptFlag ?? provider?.initialPromptFlag ?? '',
  envEntries:
    globalConfig?.env && typeof globalConfig.env === 'object'
      ? Object.entries(globalConfig.env).map(([key, value]) => ({ key, value: String(value) }))
      : [],
});

const formFromConfig = (
  config: ProviderCustomConfig | undefined,
  defaults: FormState
): FormState => ({
  cli: config?.cli ?? defaults.cli,
  resumeFlag: config?.resumeFlag ?? defaults.resumeFlag,
  defaultArgs: config?.defaultArgs ?? defaults.defaultArgs,
  extraArgs: config?.extraArgs ?? defaults.extraArgs,
  autoApproveFlag: config?.autoApproveFlag ?? defaults.autoApproveFlag,
  initialPromptFlag: config?.initialPromptFlag ?? defaults.initialPromptFlag,
  envEntries:
    config?.env && typeof config.env === 'object'
      ? Object.entries(config.env).map(([key, value]) => ({ key, value: String(value) }))
      : defaults.envEntries,
});

const sanitizeEnvEntries = (entries: EnvEntry[]): EnvEntry[] =>
  entries.filter((entry) => entry.key.trim() || entry.value.trim());

const formsEqual = (left: FormState, right: FormState): boolean =>
  left.cli === right.cli &&
  left.resumeFlag === right.resumeFlag &&
  left.defaultArgs === right.defaultArgs &&
  left.extraArgs === right.extraArgs &&
  left.autoApproveFlag === right.autoApproveFlag &&
  left.initialPromptFlag === right.initialPromptFlag &&
  JSON.stringify(sanitizeEnvEntries(left.envEntries)) ===
    JSON.stringify(sanitizeEnvEntries(right.envEntries));

const buildConfigFromForm = (
  form: FormState,
  defaults: FormState
): ProviderCustomConfig | undefined => {
  if (formsEqual(form, defaults)) return undefined;

  const envRecord: Record<string, string> = {};
  for (const { key, value } of form.envEntries) {
    const trimmedKey = key.trim();
    if (trimmedKey && /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmedKey)) {
      envRecord[trimmedKey] = value;
    }
  }

  return {
    cli: form.cli,
    resumeFlag: form.resumeFlag,
    defaultArgs: form.defaultArgs,
    extraArgs: form.extraArgs.trim() || undefined,
    autoApproveFlag: form.autoApproveFlag,
    initialPromptFlag: form.initialPromptFlag,
    env: Object.keys(envRecord).length > 0 ? envRecord : undefined,
  };
};

export default function TaskAgentPresetsModal({
  isOpen,
  onClose,
  agentIds,
  value,
  onSave,
}: TaskAgentPresetsModalProps) {
  const shouldReduceMotion = useReducedMotion();
  const normalizedAgentIds = useMemo(
    () => [...new Set(agentIds)].filter((id): id is ProviderId => Boolean(getProviderById(id))),
    [agentIds]
  );
  const [selectedAgentId, setSelectedAgentId] = useState<ProviderId | null>(
    normalizedAgentIds[0] ?? null
  );
  const [defaultsByAgent, setDefaultsByAgent] = useState<ProviderFormMap>({});
  const [formsByAgent, setFormsByAgent] = useState<ProviderFormMap>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedAgentId((current) =>
      current && normalizedAgentIds.includes(current) ? current : (normalizedAgentIds[0] ?? null)
    );
  }, [isOpen, normalizedAgentIds]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setLoading(true);

    void (async () => {
      const nextDefaults: ProviderFormMap = {};
      const nextForms: ProviderFormMap = {};

      for (const agentId of normalizedAgentIds) {
        const provider = getProviderById(agentId);
        let globalConfig: ProviderCustomConfig | undefined;
        try {
          const result = await window.electronAPI.getProviderCustomConfig?.(agentId);
          if (result?.success) globalConfig = result.config;
        } catch {}

        const defaults = getDefaultForm(provider, globalConfig);
        nextDefaults[agentId] = defaults;
        nextForms[agentId] = formFromConfig(value[agentId], defaults);
      }

      if (cancelled) return;
      setDefaultsByAgent(nextDefaults);
      setFormsByAgent(nextForms);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, normalizedAgentIds, value]);

  const selectedAgent = selectedAgentId ? getProviderById(selectedAgentId) : undefined;
  const selectedForm =
    (selectedAgentId ? formsByAgent[selectedAgentId] : undefined) ??
    (selectedAgent ? getDefaultForm(selectedAgent) : null);
  const selectedDefaults =
    (selectedAgentId ? defaultsByAgent[selectedAgentId] : undefined) ??
    (selectedAgent ? getDefaultForm(selectedAgent) : null);

  const updateSelectedForm = useCallback(
    (updater: (current: FormState) => FormState) => {
      if (!selectedAgentId || !selectedForm) return;
      setFormsByAgent((prev) => ({
        ...prev,
        [selectedAgentId]: updater(prev[selectedAgentId] ?? selectedForm),
      }));
    },
    [selectedAgentId, selectedForm]
  );

  const handleChange = useCallback(
    (field: keyof FormState, nextValue: string) => {
      updateSelectedForm((current) => ({ ...current, [field]: nextValue }));
    },
    [updateSelectedForm]
  );

  const setEnvEntry = useCallback(
    (index: number, update: Partial<EnvEntry>) => {
      updateSelectedForm((current) => {
        const nextEntries = [...current.envEntries];
        nextEntries[index] = { ...nextEntries[index], ...update };
        return { ...current, envEntries: nextEntries };
      });
    },
    [updateSelectedForm]
  );

  const addEnvEntry = useCallback(() => {
    updateSelectedForm((current) => ({
      ...current,
      envEntries: [...current.envEntries, { key: '', value: '' }],
    }));
  }, [updateSelectedForm]);

  const removeEnvEntry = useCallback(
    (index: number) => {
      updateSelectedForm((current) => ({
        ...current,
        envEntries: current.envEntries.filter((_, currentIndex) => currentIndex !== index),
      }));
    },
    [updateSelectedForm]
  );

  const handleReset = useCallback(() => {
    if (!selectedAgentId || !selectedDefaults) return;
    setFormsByAgent((prev) => ({ ...prev, [selectedAgentId]: selectedDefaults }));
  }, [selectedAgentId, selectedDefaults]);

  const hasChanges = useMemo(
    () =>
      normalizedAgentIds.some((agentId) => {
        const defaults = defaultsByAgent[agentId];
        const form = formsByAgent[agentId];
        return !!defaults && !!form && !formsEqual(form, defaults);
      }),
    [defaultsByAgent, formsByAgent, normalizedAgentIds]
  );

  const configuredCount = useMemo(
    () =>
      normalizedAgentIds.filter((agentId) => {
        const defaults = defaultsByAgent[agentId];
        const form = formsByAgent[agentId];
        return !!defaults && !!form && !formsEqual(form, defaults);
      }).length,
    [defaultsByAgent, formsByAgent, normalizedAgentIds]
  );

  const handleSave = useCallback(() => {
    const nextValue: ProviderPresetMap = {};
    for (const agentId of normalizedAgentIds) {
      const defaults = defaultsByAgent[agentId];
      const form = formsByAgent[agentId];
      if (!defaults || !form) continue;
      const config = buildConfigFromForm(form, defaults);
      if (config) nextValue[agentId] = config;
    }
    onSave(nextValue);
    onClose();
  }, [defaultsByAgent, formsByAgent, normalizedAgentIds, onClose, onSave]);

  const previewCommand = useMemo(() => {
    if (!selectedForm) return '';
    const parts: string[] = [];
    if (selectedForm.cli) parts.push(selectedForm.cli);
    if (selectedForm.resumeFlag) parts.push(selectedForm.resumeFlag);
    if (selectedForm.defaultArgs) parts.push(selectedForm.defaultArgs);
    if (selectedForm.extraArgs) parts.push(selectedForm.extraArgs);
    if (selectedForm.autoApproveFlag) parts.push(selectedForm.autoApproveFlag);
    if (selectedForm.initialPromptFlag) parts.push(selectedForm.initialPromptFlag);
    parts.push('{prompt}');
    return parts.join(' ');
  }, [selectedForm]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-agent-presets-title"
        className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
        initial={shouldReduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0 }}
        transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.12, ease: 'easeOut' }}
        onClick={onClose}
      >
        <motion.div
          onClick={(event) => event.stopPropagation()}
          initial={shouldReduceMotion ? false : { opacity: 0, y: 8, scale: 0.995 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={
            shouldReduceMotion ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 6, scale: 0.995 }
          }
          transition={
            shouldReduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }
          }
          className="flex max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-border/50 bg-background shadow-2xl"
        >
          <aside className="w-52 shrink-0 border-r border-border/60 bg-muted/20 p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 id="task-agent-presets-title" className="text-lg font-semibold">
                  Agent presets
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Override CLI args for this task only.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-8 w-8 shrink-0"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-2">
              {normalizedAgentIds.map((agentId) => {
                const provider = getProviderById(agentId);
                const defaults = defaultsByAgent[agentId];
                const form = formsByAgent[agentId];
                const configured = !!defaults && !!form && !formsEqual(form, defaults);
                return (
                  <button
                    key={agentId}
                    type="button"
                    onClick={() => setSelectedAgentId(agentId)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                      selectedAgentId === agentId
                        ? 'bg-foreground text-background'
                        : 'bg-transparent text-foreground hover:bg-accent'
                    }`}
                  >
                    <span>{provider?.name ?? agentId}</span>
                    {configured ? (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-600">
                        Custom
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="border-b border-border/60 px-6 py-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {selectedAgent?.name ?? 'Agent configuration'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Inherits from global agent settings until overridden here.
                  </p>
                </div>
                <div className="text-xs text-muted-foreground">
                  {configuredCount} of {normalizedAgentIds.length} customized
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {loading || !selectedForm || !selectedDefaults ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                  Loading presets…
                </div>
              ) : (
                <div className="space-y-4">
                  <Field
                    label="CLI Command"
                    tooltip="The CLI command to execute (for example: codex)"
                  >
                    <Input
                      value={selectedForm.cli}
                      onChange={(event) => handleChange('cli', event.target.value)}
                      placeholder={selectedDefaults.cli || 'CLI command'}
                      className="font-mono text-sm"
                    />
                  </Field>

                  <Field
                    label="Resume Flag"
                    tooltip="Flag used when resuming a session (for example: -c -r)"
                  >
                    <Input
                      value={selectedForm.resumeFlag}
                      onChange={(event) => handleChange('resumeFlag', event.target.value)}
                      placeholder={selectedDefaults.resumeFlag || '(none)'}
                      className="font-mono text-sm"
                    />
                  </Field>

                  <Field
                    label="Default Args"
                    tooltip="Default arguments such as model selection flags"
                  >
                    <Input
                      value={selectedForm.defaultArgs}
                      onChange={(event) => handleChange('defaultArgs', event.target.value)}
                      placeholder={selectedDefaults.defaultArgs || '(none)'}
                      className="font-mono text-sm"
                    />
                  </Field>

                  <Field
                    label="Additional Parameters"
                    tooltip="Extra flags appended to the command for this task only"
                  >
                    <Input
                      value={selectedForm.extraArgs}
                      onChange={(event) => handleChange('extraArgs', event.target.value)}
                      placeholder="e.g. --model gpt-5 --enable-feature"
                      className="font-mono text-sm"
                    />
                  </Field>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm font-medium">Environment variables</Label>
                      <FieldTooltip content="Environment variables set when running this agent for the task" />
                    </div>
                    <div className="space-y-2">
                      {selectedForm.envEntries.map((entry, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <Input
                            value={entry.key}
                            onChange={(event) => setEnvEntry(index, { key: event.target.value })}
                            placeholder="KEY"
                            className="min-w-0 flex-1 font-mono text-sm"
                          />
                          <Input
                            value={entry.value}
                            onChange={(event) => setEnvEntry(index, { value: event.target.value })}
                            placeholder="value"
                            className="min-w-0 flex-1 font-mono text-sm"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeEnvEntry(index)}
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

                  <Field
                    label="Auto-approve Flag"
                    tooltip="Flag used when task auto-approve is enabled"
                  >
                    <Input
                      value={selectedForm.autoApproveFlag}
                      onChange={(event) => handleChange('autoApproveFlag', event.target.value)}
                      placeholder={selectedDefaults.autoApproveFlag || '(none)'}
                      className="font-mono text-sm"
                    />
                  </Field>

                  <Field
                    label="Initial Prompt Flag"
                    tooltip="Flag for passing the initial prompt; leave empty to pass the prompt directly"
                  >
                    <Input
                      value={selectedForm.initialPromptFlag}
                      onChange={(event) => handleChange('initialPromptFlag', event.target.value)}
                      placeholder={selectedDefaults.initialPromptFlag || '(pass directly)'}
                      className="font-mono text-sm"
                    />
                  </Field>

                  <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
                    <div className="mb-2 text-xs font-medium text-muted-foreground">
                      Command preview
                    </div>
                    <code className="block break-all font-mono text-sm text-foreground">
                      {previewCommand}
                    </code>
                  </div>
                </div>
              )}
            </div>

            <footer className="flex items-center justify-between border-t border-border/60 px-6 py-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleReset}
                disabled={loading || !selectedForm || !selectedDefaults}
                className="gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset agent
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSave}
                  disabled={loading || !hasChanges}
                >
                  Save presets
                </Button>
              </div>
            </footer>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

function Field({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label className="text-sm font-medium">{label}</Label>
        <FieldTooltip content={tooltip} />
      </div>
      {children}
    </div>
  );
}

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
      <TooltipContent side="top" className="max-w-[220px] text-xs">
        {content}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);
