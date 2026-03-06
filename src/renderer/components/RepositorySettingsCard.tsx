import React, { useMemo, useState } from 'react';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { useAppSettings } from '@/contexts/AppSettingsProvider';
import { rpc } from '@/lib/rpc';
import { useToast } from '@/hooks/use-toast';

type RepoSettings = {
  branchPrefix: string;
  pushOnCreate: boolean;
  worktreesDirectory?: string;
};

const DEFAULTS: RepoSettings = {
  branchPrefix: 'emdash',
  pushOnCreate: true,
};

const RepositorySettingsCard: React.FC = () => {
  const { settings, updateSettings, isLoading: loading, isSaving: saving } = useAppSettings();
  const { toast } = useToast();
  const [worktreesError, setWorktreesError] = useState<string | null>(null);

  const { repository } = settings ?? {};

  const example = useMemo(() => {
    const prefix = repository?.branchPrefix || DEFAULTS.branchPrefix;
    return `${prefix}/my-feature-a3f`;
  }, [repository?.branchPrefix]);

  const handleWorktreesBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
    const value = e.target.value.trim();
    setWorktreesError(null);
    if (!value) {
      updateSettings({ repository: { worktreesDirectory: '' } });
      return;
    }
    const err = await rpc.appSettings.validateWorktreesPath(value);
    if (err) {
      setWorktreesError(err);
      return;
    }
    try {
      updateSettings({ repository: { worktreesDirectory: value } });
    } catch (e) {
      toast({
        title: 'Failed to save',
        description: e instanceof Error ? e.message : 'Invalid worktrees path',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="grid gap-8">
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
      <div className="grid gap-2">
        <Input
          key={repository?.worktreesDirectory ?? 'default'}
          defaultValue={repository?.worktreesDirectory ?? ''}
          onBlur={handleWorktreesBlur}
          placeholder="../worktrees (default)"
          aria-label="Worktrees directory"
          disabled={loading}
        />
        <div className="text-[11px] text-muted-foreground">
          Base path for worktree directories. Leave empty for default (sibling of project). Supports
          ~ for home.
        </div>
        {worktreesError && <div className="text-[11px] text-destructive">{worktreesError}</div>}
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="text-sm font-medium text-foreground">Auto-push to origin</div>
          <div className="text-sm">
            Push the new branch to origin and set upstream after creation.
          </div>
        </div>
        <Switch
          defaultChecked={repository?.pushOnCreate ?? DEFAULTS.pushOnCreate}
          onCheckedChange={(checked) => updateSettings({ repository: { pushOnCreate: checked } })}
          disabled={loading || saving}
          aria-label="Enable automatic push on create"
        />
      </div>
    </div>
  );
};

export default RepositorySettingsCard;
