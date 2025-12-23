import React, { useEffect, useState } from 'react';
import { useToast } from '../hooks/use-toast';
import { Switch } from './ui/switch';

const KanbanSettingsCard: React.FC = () => {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState<boolean>(true);
  const [isUpdating, setIsUpdating] = useState(false);

  // Load initial setting value
  useEffect(() => {
    const loadSetting = async () => {
      try {
        const result = await window.electronAPI.getSettings();
        if (result.success && result.settings) {
          const isEnabled = Boolean(result.settings.features?.kanban?.enabled ?? true);
          setEnabled(isEnabled);
        }
      } catch (error) {
        console.error('Failed to load kanban setting:', error);
      }
    };

    loadSetting();
  }, []);

  const handleToggle = async (next: boolean) => {
    setIsUpdating(true);
    try {
      await window.electronAPI.updateSettings({
        features: { kanban: { enabled: next } },
      });
      setEnabled(next);
    } catch (error) {
      console.error('Failed to update kanban enabled setting:', error);
      toast({
        title: 'Failed to update setting',
        description: (error as Error).message || 'Could not save Kanban setting',
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
      <div className="mb-4 text-sm text-muted-foreground">
        Control the visibility of the Kanban board feature.
      </div>
      <div className="space-y-3">
        <label className="flex items-center justify-between gap-2">
          <span className="text-sm">Enable Kanban board</span>
          <Switch checked={enabled} disabled={isUpdating} onCheckedChange={handleToggle} />
        </label>
      </div>
    </div>
  );
};

export default KanbanSettingsCard;
