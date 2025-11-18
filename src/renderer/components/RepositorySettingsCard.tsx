import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Input } from './ui/input';
import { Switch } from './ui/switch';

type RepoSettings = {
  branchTemplate: string;
  pushOnCreate: boolean;
};

const DEFAULTS: RepoSettings = {
  branchTemplate: 'agent/{slug}-{timestamp}',
  pushOnCreate: true,
};

const PLACEHOLDER_HELP = 'Use {slug} for the task name and {timestamp} for epoch milliseconds.';

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
          branchTemplate: repo.branchTemplate ?? DEFAULTS.branchTemplate,
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
            branchTemplate: repo.branchTemplate ?? DEFAULTS.branchTemplate,
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
    // lightweight preview using fake slug and timestamp
    const tpl = settings.branchTemplate || DEFAULTS.branchTemplate;
    const now = Date.now();
    return tpl.replace(/\{slug\}/g, 'my-feature').replace(/\{timestamp\}/g, String(now));
  }, [settings.branchTemplate]);

  return (
    <div className="grid gap-3">
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">New branch name template</span>
        <Input
          value={settings.branchTemplate}
          onChange={(e) => setSettings((s) => ({ ...s, branchTemplate: e.target.value }))}
          onBlur={() => savePartial({ branchTemplate: settings.branchTemplate.trim() })}
          placeholder={DEFAULTS.branchTemplate}
          aria-label="New branch name template"
          disabled={loading}
        />
        <span className="text-[11px] text-muted-foreground">{PLACEHOLDER_HELP}</span>
        <div className="text-[11px] text-muted-foreground">
          Example: <code className="rounded bg-muted/60 px-1">{example}</code>
        </div>
      </label>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="text-sm text-foreground">Auto-push to origin</div>
          <div>Push the new branch to origin and set upstream after creation.</div>
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
