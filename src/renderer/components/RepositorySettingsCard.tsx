import React, { useMemo } from 'react';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { useAppSettings } from '@/contexts/AppSettingsProvider';

type RepoSettings = {
  branchPrefix: string;
  pushOnCreate: boolean;
  autoCloseLinkedIssuesOnPrCreate: boolean;
};

const DEFAULTS: RepoSettings = {
  branchPrefix: 'emdash',
  pushOnCreate: true,
  autoCloseLinkedIssuesOnPrCreate: true,
};

const RepositorySettingsCard: React.FC = () => {
  const { settings, updateSettings, isLoading: loading, isSaving: saving } = useAppSettings();

  const { repository } = settings ?? {};

  const example = useMemo(() => {
    const prefix = repository?.branchPrefix || DEFAULTS.branchPrefix;
    return `${prefix}/my-feature-a3f`;
  }, [repository?.branchPrefix]);

  return (
    <div id="repository-settings-card" className="grid gap-8">
      <div className="grid gap-2">
        <Input
          defaultValue={repository?.branchPrefix ?? DEFAULTS.branchPrefix}
          onBlur={(e) => updateSettings({ repository: { branchPrefix: e.target.value.trim() } })}
          placeholder="Branch prefix"
          aria-label="Branch prefix"
          disabled={loading}
        />
        <div className="text-[11px] text-muted-foreground">
          Example: <code className="rounded bg-muted/60 px-1">{example}</code>
        </div>
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
