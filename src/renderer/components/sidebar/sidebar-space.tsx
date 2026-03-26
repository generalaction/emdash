import { PanelLeft } from 'lucide-react';
import { useWorkspaceLayoutContext } from '@renderer/core/view/layout-provider';
import ShortcutHint from '../ui/shortcut-hint';
import { Toggle } from '../ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

export function SidebarSpace() {
  const { isLeftOpen, setCollapsed } = useWorkspaceLayoutContext();
  return (
    <div className="[-webkit-app-region:drag] flex h-10 w-full justify-end bg-accent">
      <Tooltip>
        <TooltipTrigger>
          <Toggle
            className="[-webkit-app-region:no-drag]"
            pressed={isLeftOpen}
            onPressedChange={() => setCollapsed('left', isLeftOpen)}
          >
            <PanelLeft className="h-4 w-4" />
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
