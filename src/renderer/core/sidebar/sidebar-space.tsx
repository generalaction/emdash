import { PanelLeft } from 'lucide-react';
import { useWorkspaceLayoutContext } from '@renderer/core/view/layout-provider';
import ShortcutHint from '../../components/ui/shortcut-hint';
import { Toggle } from '../../components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';

export function SidebarSpace() {
  const { isLeftOpen, setCollapsed } = useWorkspaceLayoutContext();
  return (
    <div className="[-webkit-app-region:drag] flex h-10 w-full justify-end px-2">
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
