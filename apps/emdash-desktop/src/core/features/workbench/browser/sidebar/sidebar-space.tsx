import { PanelLeft } from 'lucide-react';
import { NavButtons } from '@core/primitives/ui/browser/components/nav-buttons';
import { BoundShortcut } from '@core/primitives/ui/browser/shortcut';
import { Toggle } from '@core/primitives/ui/browser/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@core/primitives/ui/browser/tooltip';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';

export function SidebarSpace() {
  const { isLeftOpen, setCollapsed } = useWorkspaceLayoutContext();
  return (
    <div className="flex h-10 w-full items-center justify-end gap-2 px-2 [-webkit-app-region:drag]">
      <NavButtons />
      <Tooltip>
        <TooltipTrigger>
          <Toggle
            className="size-7 border-none bg-background-tertiary-3 [-webkit-app-region:no-drag] hover:bg-background-tertiary-3 data-pressed:bg-background-tertiary-2"
            variant="outline"
            size="sm"
            pressed={isLeftOpen}
            onPressedChange={() => setCollapsed('left', isLeftOpen)}
          >
            <PanelLeft className="h-4 w-4" />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>
          Toggle left sidebar
          <BoundShortcut command="workbench.toggleLeftSidebar" variant="keycaps" />
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
