import type { InstallMethod, InstallOption } from '@emdash/cli-agent-plugins';
import { metadataRegistry } from '@emdash/cli-agent-plugins/metadata';
import { Check, Copy, ExternalLink, Info, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useProviderSettings } from '@renderer/features/settings/use-provider-settings';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { getAgentUpdateActionState } from '@renderer/lib/components/agent-selector/agent-install';
import { parseEnvAssignmentPaste, replaceEnvEntryWithPaste } from '@renderer/lib/env-paste';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@renderer/lib/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { log } from '@renderer/utils/logger';
import type { ProviderCustomConfig } from '@shared/core/app-settings';

interface AgentDetailSheetProps {
  agentId: string | null;
  onClose: () => void;
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
    defaults: storedDefaults,
    isOverridden,
    isLoading,
    update,
    reset,
  } = useProviderSettings(agentId);

  const defaultCli = storedDefaults?.cli ?? agentId;
  const defaultFormState = useMemo<FormState>(
    () => ({ cli: defaultCli, extraArgs: '', envEntries: [] }),
    [defaultCli]
  );

  const [form, setForm] = useState<FormState>(defaultFormState);
  const [saving, setSaving] = useState(false);

  const installOptions = useMemo(
    () => agentPayload?.installOptions ?? [],
    [agentPayload?.installOptions]
  );
  const defaultInstallMethod =
    installOptions.find((o) => o.recommended)?.method ?? installOptions[0]?.method ?? null;
  const [selectedInstallMethod, setSelectedInstallMethod] = useState<InstallMethod | null>(
    defaultInstallMethod
  );
  useEffect(() => {
    setSelectedInstallMethod(
      installOptions.find((o) => o.recommended)?.method ?? installOptions[0]?.method ?? null
    );
  }, [agentId, installOptions]);

  useEffect(() => {
    if (isLoading) return;
    if (storedConfig && isOverridden) {
      setForm(configToFormState(storedConfig, defaultCli));
    } else {
      setForm(defaultFormState);
    }
  }, [isLoading, storedConfig, isOverridden, defaultFormState, defaultCli]);

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
        if (k && /^[A-Za-z_]\w*$/.test(k)) {
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

  const providerName = meta?.name ?? agentId;
  const isInstalled = agentPayload?.status === 'available';

  const updateStrategyKind =
    agentPayload?.capabilities.updates.kind === 'supported'
      ? agentPayload.capabilities.updates.update.kind
      : 'none';
  const isUpdating = appState.dependencies.isUpdating(agentId as never);
  const updateState = getAgentUpdateActionState({
    updateAvailable: agentPayload?.updateAvailable ?? false,
    updateStrategyKind,
    version: agentPayload?.version ?? null,
    latestVersion: agentPayload?.latestVersion ?? null,
    isUpdating,
  });

  return (
    <>
      <SheetHeader className="border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background-1 p-1.5">
            <AgentIcon id={agentId} size={20} />
          </div>
          <div className="flex-1">
            <SheetTitle>{providerName}</SheetTitle>
            <SheetDescription>Execution Settings</SheetDescription>
          </div>
          {updateState.render && (
            <span className="rounded-md bg-background-warning px-1.5 py-0.5 text-xs text-foreground-warning">
              Update available
            </span>
          )}
        </div>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {!isInstalled ? (
          <InstallOptionsView
            agentName={providerName}
            websiteUrl={agentPayload?.websiteUrl ?? meta?.websiteUrl ?? null}
            installOptions={agentPayload?.installOptions ?? []}
            selectedMethod={selectedInstallMethod}
            onSelectMethod={setSelectedInstallMethod}
          />
        ) : isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-muted-foreground text-sm">Loading...</div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="sheet-cli" className="text-sm font-medium">
                  CLI Command
                </Label>
                <FieldTooltip content="The CLI command to execute (e.g., claude, codex)" />
              </div>
              <Input
                id="sheet-cli"
                value={form.cli}
                onChange={(e) => handleChange('cli', e.target.value)}
                placeholder={defaultCli || 'CLI command'}
                className="font-mono text-sm"
              />
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
                onChange={(e) => handleChange('extraArgs', e.target.value)}
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

            <div className="bg-muted/30 mt-6 rounded-lg border border-border/60 p-4">
              <div className="text-muted-foreground mb-2 text-xs font-medium">Command Preview</div>
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
        {updateState.render && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={updateState.disabled}
            onClick={() => {
              appState.dependencies.update(agentId as never).catch(() => undefined);
            }}
          >
            {updateState.label}
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
          {isInstalled ? 'Cancel' : 'Close'}
        </Button>
        {isInstalled ? (
          <ConfirmButton
            type="button"
            size="sm"
            onClick={() => void handleSave()}
            disabled={isLoading || saving || !hasChanges}
          >
            {saving ? 'Saving...' : 'Save'}
          </ConfirmButton>
        ) : (
          <InstallButton agentId={agentId} method={selectedInstallMethod} onClose={onClose} />
        )}
      </SheetFooter>
    </>
  );
});

function humanizeMethod(method: InstallMethod): string {
  const labels: Record<InstallMethod, string> = {
    'installer-macos': 'macOS Installer',
    'installer-windows': 'Windows Installer',
    'installer-linux': 'Linux Installer',
    homebrew: 'Homebrew',
    winget: 'winget',
    npm: 'npm',
    apt: 'apt',
    curl: 'curl',
    pip: 'pip',
    cargo: 'cargo',
    other: 'Other',
  };
  return labels[method] ?? method;
}

function InstallOptionsView({
  agentName,
  websiteUrl,
  installOptions,
  selectedMethod,
  onSelectMethod,
}: {
  agentName: string;
  websiteUrl: string | null;
  installOptions: InstallOption[];
  selectedMethod: InstallMethod | null;
  onSelectMethod: (method: InstallMethod) => void;
}) {
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  const handleCopy = useCallback((command: string) => {
    void navigator.clipboard.writeText(command).then(() => {
      setCopiedCommand(command);
      setTimeout(() => setCopiedCommand(null), 2000);
    });
  }, []);

  if (installOptions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <p className="text-sm text-foreground-muted">
          No install command is available for your platform.
        </p>
        {websiteUrl && (
          <a
            href={websiteUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-foreground-link hover:underline"
          >
            Visit {agentName} website
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Install method</Label>
        {websiteUrl && (
          <a
            href={websiteUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground hover:underline"
          >
            Documentation
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <div className="space-y-2">
        {installOptions.map((opt) => {
          const isSelected = selectedMethod === opt.method;
          return (
            <button
              key={opt.method}
              type="button"
              onClick={() => onSelectMethod(opt.method)}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${
                isSelected
                  ? 'border-border-focus bg-background-1'
                  : 'border-border hover:border-border-hover hover:bg-background-1/50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">
                  {opt.label ?? humanizeMethod(opt.method)}
                </span>
                {isSelected && <Check className="h-4 w-4 shrink-0 text-foreground-link" />}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground-muted">
                  {opt.command}
                </code>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy(opt.command);
                  }}
                  className="shrink-0 rounded p-1 text-foreground-muted hover:bg-background-2 hover:text-foreground"
                  aria-label="Copy command"
                >
                  {copiedCommand === opt.command ? (
                    <Check className="h-3.5 w-3.5 text-foreground-success" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const InstallButton = observer(function InstallButton({
  agentId,
  method,
  onClose,
}: {
  agentId: string;
  method: InstallMethod | null;
  onClose: () => void;
}) {
  const isInstalling = appState.dependencies.isInstalling(agentId as never);

  const handleInstall = useCallback(async () => {
    if (!method || isInstalling) return;
    const result = await appState.dependencies.install(agentId as never, undefined, method ?? undefined);
    if (result.success) {
      onClose();
    }
  }, [agentId, method, isInstalling, onClose]);

  return (
    <Button
      type="button"
      size="sm"
      onClick={() => void handleInstall()}
      disabled={!method || isInstalling}
    >
      {isInstalling && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
      {isInstalling ? 'Installing…' : 'Install'}
    </Button>
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
