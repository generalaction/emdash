import React, { useCallback, useEffect, useState } from 'react';
import { Switch } from './ui/switch';

type PrepSettings = {
  autoInstallOnOpenInEditor: boolean;
};

const DEFAULTS: PrepSettings = {
  autoInstallOnOpenInEditor: true,
};

const ProjectPrepSettingsCard: React.FC = () => {
  const [settings, setSettings] = useState<PrepSettings>(DEFAULTS);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  const load = useCallback(async () => {
    try {
      const res = await window.electronAPI.getSettings();
      if (res?.success && res.settings?.projectPrep) {
        const prep = res.settings.projectPrep as any;
        setSettings({
          autoInstallOnOpenInEditor:
            typeof prep.autoInstallOnOpenInEditor === 'boolean'
              ? prep.autoInstallOnOpenInEditor
              : DEFAULTS.autoInstallOnOpenInEditor,
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

  const save = useCallback(
    async (partial: Partial<PrepSettings>) => {
      setSaving(true);
      try {
        const next = { ...settings, ...partial };
        const res = await window.electronAPI.updateSettings({ projectPrep: next as any });
        if (res?.success && res.settings?.projectPrep) {
          const prep = res.settings.projectPrep as any;
          setSettings({
            autoInstallOnOpenInEditor:
              typeof prep.autoInstallOnOpenInEditor === 'boolean'
                ? prep.autoInstallOnOpenInEditor
                : DEFAULTS.autoInstallOnOpenInEditor,
          });
        }
      } finally {
        setSaving(false);
      }
    },
    [settings]
  );

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-1 text-xs text-muted-foreground">
        <div className="text-sm text-foreground">Auto-install on “Open in …”</div>
        <div>
          For Node projects only: when opening a worktree in Cursor, VS Code, or Zed, install
          dependencies in the background (uses pnpm/yarn/bun/npm based on lockfile) if
          <code className="mx-1 rounded bg-muted/60 px-1">node_modules</code> is missing.
        </div>
      </div>
      <Switch
        checked={settings.autoInstallOnOpenInEditor}
        onCheckedChange={(checked) => save({ autoInstallOnOpenInEditor: Boolean(checked) })}
        disabled={loading || saving}
        aria-label="Enable auto-install on Open in …"
      />
    </div>
  );
};

export default ProjectPrepSettingsCard;
