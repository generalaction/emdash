import React, { useState } from 'react';
import { Switch } from './ui/switch';

type PrepSettings = {
  autoInstallOnOpenInEditor: boolean;
};

const DEFAULTS: PrepSettings = {
  autoInstallOnOpenInEditor: true,
};

const ProjectPrepSettingsCard: React.FC = () => {
  const [settings, setSettings] = useState<PrepSettings>(DEFAULTS);

  const handleChange = (checked: boolean) => {
    setSettings((prev) => ({ ...prev, autoInstallOnOpenInEditor: checked }));
  };

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-1 text-xs text-muted-foreground">
        <div className="text-sm text-foreground">Auto-install on "Open in …"</div>
        <div>
          For Node projects only: when opening a worktree in Cursor, VS Code, or Zed, install
          dependencies in the background (uses pnpm/yarn/bun/npm based on lockfile) if
          <code className="mx-1 rounded bg-muted/60 px-1">node_modules</code> is missing.
        </div>
      </div>
      <Switch
        checked={settings.autoInstallOnOpenInEditor}
        onCheckedChange={(checked) => handleChange(Boolean(checked))}
        aria-label="Enable auto-install on Open in …"
      />
    </div>
  );
};

export default ProjectPrepSettingsCard;
