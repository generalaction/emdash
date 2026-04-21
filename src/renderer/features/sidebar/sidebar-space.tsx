import { PanelLeft } from 'lucide-react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { ResourceMonitor } from '@renderer/lib/components/titlebar/resource-monitor';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Toggle } from '@renderer/lib/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

export function SidebarSpace() {
  const { isLeftOpen, setCollapsed } = useWorkspaceLayoutContext();
  const { value: resourceMonitor } = useAppSettingsKey('resourceMonitor');
  const resourceMonitorEnabled = resourceMonitor?.enabled ?? false;
  return (
    <div className="[-webkit-app-region:drag] flex h-10 w-full items-center justify-end gap-1 px-2">
      {resourceMonitorEnabled && (
        <div className="[-webkit-app-region:no-drag] flex items-center">
          <ResourceMonitor />
        </div>
      )}
      <Tooltip>
        <TooltipTrigger>
          <Toggle
            className="[-webkit-app-region:no-drag] size-7 bg-background-tertiary-3 hover:bg-background-tertiary-3 data-pressed:bg-background-tertiary-2"
            variant="outline"
            size="sm"
            pressed={isLeftOpen}
            onPressedChange={() => setCollapsed('left', isLeftOpen)}
          >
            <PanelLeft />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>
          Toggle left sidebar
          <ShortcutHint settingsKey="toggleLeftSidebar" />
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
