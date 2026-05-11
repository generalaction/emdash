import { PanelLeft } from 'lucide-react';
import { NavButtons } from '@renderer/lib/components/nav-buttons';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Toggle } from '@renderer/lib/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

export function SidebarSpace() {
  const { isLeftOpen, setCollapsed } = useWorkspaceLayoutContext();
  return (
    <div className="[-webkit-app-region:drag] flex h-10 w-full items-center justify-end gap-2 px-2">
      <NavButtons />
      <Tooltip>
        <TooltipTrigger>
          <Toggle
            className="[-webkit-app-region:no-drag] size-7 bg-background-tertiary-3 hover:bg-background-tertiary-3 data-pressed:bg-background-tertiary-2 border-none"
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
