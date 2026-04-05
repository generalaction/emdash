import React, { useMemo, useState } from 'react';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { useAppSettings } from '@/contexts/AppSettingsProvider';

type RepoSettings = {
  branchPrefix: string;
  appendHashToBranch: boolean;
  pushOnCreate: boolean;
  autoCloseLinkedIssuesOnPrCreate: boolean;
};

const DEFAULTS: RepoSettings = {
  branchPrefix: 'emdash',
  appendHashToBranch: true,
  pushOnCreate: true,
  autoCloseLinkedIssuesOnPrCreate: true,
};

const RepositorySettingsCard: React.FC = () => {
  const { settings, updateSettings, isLoading: loading, isSaving: saving } = useAppSettings();

  const { repository } = settings ?? {};

  // Derive mode from the stored prefix: empty string = 'none', anything else = 'custom'
  const storedPrefix = repository?.branchPrefix ?? DEFAULTS.branchPrefix;
  const mode = storedPrefix === '' ? 'none' : 'custom';

  // Local draft for the custom input so typing doesn't trigger saves on every keystroke
  const [customDraft, setCustomDraft] = useState<string | null>(null);
  const displayPrefix = customDraft ?? (mode === 'custom' ? storedPrefix : DEFAULTS.branchPrefix);

  const appendHash = repository?.appendHashToBranch ?? DEFAULTS.appendHashToBranch;
  const hashSuffix = appendHash ? '-a3f' : '';

  const example = useMemo(() => {
    if (mode === 'none') return `fix/login-page${hashSuffix}`;
    const prefix = displayPrefix || DEFAULTS.branchPrefix;
    return `${prefix}/my-feature${hashSuffix}`;
  }, [mode, displayPrefix, hashSuffix]);

  const handleModeChange = (value: string) => {
    if (value === 'none') {
      setCustomDraft(null);
      updateSettings({ repository: { branchPrefix: '' } });
    } else {
      const prefix = (customDraft ?? storedPrefix) || DEFAULTS.branchPrefix;
      setCustomDraft(null);
      updateSettings({ repository: { branchPrefix: prefix } });
    }
  };

  const handleCustomBlur = (value: string) => {
    const trimmed = value.trim();
    setCustomDraft(null);
    if (trimmed) {
      updateSettings({ repository: { branchPrefix: trimmed } });
    }
  };

  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        <RadioGroup value={mode} onValueChange={handleModeChange} disabled={loading}>
          <div className="flex items-start gap-2">
            <RadioGroupItem value="custom" id="prefix-custom" className="mt-0.5" />
            <div className="grid flex-1 gap-1.5">
              <label htmlFor="prefix-custom" className="cursor-pointer text-sm font-medium">
                Custom
              </label>
              <Input
                value={customDraft ?? (mode === 'custom' ? storedPrefix : DEFAULTS.branchPrefix)}
                onChange={(e) => setCustomDraft(e.target.value)}
                onBlur={(e) => handleCustomBlur(e.target.value)}
                onFocus={() => {
                  if (mode === 'none') handleModeChange('custom');
                }}
                placeholder="e.g. feature/ or myname/"
                aria-label="Branch prefix"
                disabled={loading || mode === 'none'}
                className="max-w-xs"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="none" id="prefix-none" />
            <label htmlFor="prefix-none" className="cursor-pointer text-sm font-medium">
              None
            </label>
          </div>
        </RadioGroup>
        <div className="text-[11px] text-muted-foreground">
          Example: <code className="rounded bg-muted/60 px-1">{example}</code>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="text-sm font-medium text-foreground">Append hash to branch name</div>
          <div className="text-sm">
            Add a short hash suffix for uniqueness (e.g.{' '}
            <code className="rounded bg-muted/60 px-1">-a3f</code>).
          </div>
        </div>
        <Switch
          checked={appendHash}
          onCheckedChange={(checked) =>
            updateSettings({ repository: { appendHashToBranch: checked } })
          }
          disabled={loading || saving}
          aria-label="Append hash to branch name"
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="text-sm font-medium text-foreground">Auto-push to origin</div>
          <div className="text-sm">
            Push the new branch to origin and set upstream after creation.
          </div>
        </div>
        <Switch
          checked={repository?.pushOnCreate ?? DEFAULTS.pushOnCreate}
          onCheckedChange={(checked) => updateSettings({ repository: { pushOnCreate: checked } })}
          disabled={loading || saving}
          aria-label="Enable automatic push on create"
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="text-sm font-medium text-foreground">
            Auto-close linked issues on PR creation
          </div>
          <div className="text-sm">
            Add Emdash-managed closing keywords to new PRs so linked GitHub and Linear issues are
            closed automatically. Disable this if your team closes issues only after testing,
            deployment, or external approval.
          </div>
        </div>
        <Switch
          checked={
            repository?.autoCloseLinkedIssuesOnPrCreate ?? DEFAULTS.autoCloseLinkedIssuesOnPrCreate
          }
          onCheckedChange={(checked) =>
            updateSettings({ repository: { autoCloseLinkedIssuesOnPrCreate: checked } })
          }
          disabled={loading || saving}
          aria-label="Enable automatic closing of linked issues on pull request creation"
        />
      </div>
    </div>
  );
};

export default RepositorySettingsCard;
