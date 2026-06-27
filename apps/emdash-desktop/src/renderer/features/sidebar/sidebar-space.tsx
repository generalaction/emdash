import { detectPlatform } from '@tanstack/react-hotkeys';
import { PanelLeft } from 'lucide-react';
import { NavButtons } from '@renderer/lib/components/nav-buttons';
import { WindowMenuBar } from '@renderer/lib/components/titlebar/window-menu-bar';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { BoundShortcut } from '@renderer/lib/ui/shortcut';
import { Toggle } from '@renderer/lib/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

const isMac = detectPlatform() === 'mac';

export function SidebarSpace() {
  const { isLeftOpen, setCollapsed } = useWorkspaceLayoutContext();
  return (
    <div
      className={cn(
        'flex h-10 w-full items-center gap-2 px-2 [-webkit-app-region:drag]',
        // macOS keeps the controls on the right so the top-left stays clear for
        // the traffic lights; Windows/Linux group them on the left.
        isMac ? 'justify-end' : 'justify-start'
      )}
    >
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
          <BoundShortcut settingsKey="toggleLeftSidebar" variant="keycaps" />
        </TooltipContent>
      </Tooltip>
      {isLeftOpen && (
        <>
          {/* Sits to the right of the nav + collapse controls on Windows/Linux;
              renders nothing on macOS. */}
          <WindowMenuBar />
        </>
      )}
    </div>
  );
}
