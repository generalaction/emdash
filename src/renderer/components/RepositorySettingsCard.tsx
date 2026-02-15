import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Input } from './ui/input';
import { Switch } from './ui/switch';

type RepoSettings = {
  branchPrefix: string;
  pushOnCreate: boolean;
};

const DEFAULTS: RepoSettings = {
  branchPrefix: 'emdash',
  pushOnCreate: true,
};

const RepositorySettingsCard: React.FC = () => {
  const [settings, setSettings] = useState<RepoSettings>(DEFAULTS);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  const load = useCallback(async () => {
    try {
      const res = await window.electronAPI.getSettings();
      if (res?.success && res.settings?.repository) {
        const repo = res.settings.repository;
        setSettings({
          branchPrefix: repo.branchPrefix ?? DEFAULTS.branchPrefix,
          pushOnCreate: repo.pushOnCreate ?? DEFAULTS.pushOnCreate,
        });
      } else {
        setSettings(DEFAULTS);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const savePartial = useCallback(
    async (partial: Partial<RepoSettings>) => {
      setSaving(true);
      try {
        const next = { ...settings, ...partial };
        const res = await window.electronAPI.updateSettings({ repository: next });
        if (res?.success && res.settings?.repository) {
          const repo = res.settings.repository;
          setSettings({
            branchPrefix: repo.branchPrefix ?? DEFAULTS.branchPrefix,
            pushOnCreate: repo.pushOnCreate ?? DEFAULTS.pushOnCreate,
          });
        }
      } finally {
        setSaving(false);
      }
    },
    [settings]
  );

  const example = useMemo(() => {
    const prefix = settings.branchPrefix.trim();
    if (!prefix) {
      return 'my-feature-a3f';
    }
    return `${prefix}/my-feature-a3f`;
  }, [settings.branchPrefix]);

  return (
    <div className="grid gap-8">
      <div className="grid gap-2">
        <Input
          value={settings.branchPrefix}
          onChange={(e) => setSettings((s) => ({ ...s, branchPrefix: e.target.value }))}
          onBlur={() => savePartial({ branchPrefix: settings.branchPrefix.trim() })}
          placeholder="Branch prefix (optional)"
          aria-label="Branch prefix (optional)"
          disabled={loading}
        />
        <div className="text-[11px] text-muted-foreground">
          Example: <code className="rounded bg-muted/60 px-1">{example}</code>
          <br />
          <span className="text-[10px]">
            Leave empty for no prefix. You can also override this per task during creation.
          </span>
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
          checked={settings.pushOnCreate}
          onCheckedChange={(checked) => savePartial({ pushOnCreate: Boolean(checked) })}
          disabled={loading || saving}
          aria-label="Enable automatic push on create"
        />
      </div>
    </div>
  );
};

export default RepositorySettingsCard;
