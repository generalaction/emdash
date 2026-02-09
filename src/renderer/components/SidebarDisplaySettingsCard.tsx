import React, { useEffect, useState } from 'react';
import { Switch } from './ui/switch';

const SidebarDisplaySettingsCard: React.FC = () => {
  const [showGitRepo, setShowGitRepo] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const result = await window.electronAPI.getSettings();
        if (result.success && result.settings) {
          setShowGitRepo(Boolean(result.settings.interface?.showGitRepoInSidebar ?? true));
        }
      } catch (error) {
        console.error('Failed to load sidebar display settings:', error);
      }
      setLoading(false);
    })();
  }, []);

  const handleToggle = async (next: boolean) => {
    setShowGitRepo(next);
    try {
      await window.electronAPI.updateSettings({
        interface: { showGitRepoInSidebar: next },
      });
      window.dispatchEvent(
        new CustomEvent('showGitRepoInSidebarChanged', { detail: { enabled: next } })
      );
    } catch (error) {
      console.error('Failed to update sidebar display setting:', error);
    }
  };

  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
      <div className="mb-4 text-sm text-muted-foreground">
        Control what appears below project names in the sidebar.
      </div>
      <div className="space-y-3">
        <label className="flex items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm">Show GitHub repository</span>
            <span className="text-xs text-muted-foreground">
              Display owner/repo instead of the local path
            </span>
          </div>
          <Switch checked={showGitRepo} disabled={loading} onCheckedChange={handleToggle} />
        </label>
      </div>
    </div>
  );
};

export default SidebarDisplaySettingsCard;
