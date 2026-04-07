import React from 'react';
import { Switch } from './ui/switch';
import { useAppSettings } from '@/contexts/AppSettingsProvider';

const RightSidebarSettingsCard: React.FC = () => {
  const { settings, updateSettings, isLoading: loading } = useAppSettings();

  const { interface: interfaceSettings } = settings ?? {};

  const autoRightSidebarBehavior = interfaceSettings?.autoRightSidebarBehavior ?? false;

  return (
    <div id="right-sidebar-settings-card" className="flex items-center justify-between gap-4">
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">
          Auto-collapse right sidebar on home pages
        </span>
        <span className="text-sm text-muted-foreground">
          Collapse sidebar on home/repo pages, expand on tasks
        </span>
      </div>
      <Switch
        checked={autoRightSidebarBehavior}
        defaultChecked={autoRightSidebarBehavior}
        disabled={loading}
        onCheckedChange={(checked) =>
          updateSettings({ interface: { autoRightSidebarBehavior: checked } })
        }
      />
    </div>
  );
};

export default RightSidebarSettingsCard;
