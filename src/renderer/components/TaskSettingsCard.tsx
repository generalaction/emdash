import React, { useEffect, useState } from 'react';
import { Switch } from './ui/switch';

const TaskSettingsCard: React.FC = () => {
  const [autoGenerateName, setAutoGenerateName] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.electronAPI.getSettings().then((result) => {
      if (result.success) {
        setAutoGenerateName(result.settings?.tasks?.autoGenerateName ?? true);
      }
      setLoading(false);
    });
  }, []);

  const updateAutoGenerateName = (next: boolean) => {
    setAutoGenerateName(next);
    window.electronAPI.updateSettings({ tasks: { autoGenerateName: next } });
  };

  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
      <label className="flex items-center justify-between gap-2">
        <span className="text-sm">Auto-generate task names</span>
        <Switch
          checked={autoGenerateName}
          disabled={loading}
          onCheckedChange={updateAutoGenerateName}
        />
      </label>
    </div>
  );
};

export default TaskSettingsCard;
