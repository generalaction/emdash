import { PanelLeft } from 'lucide-react';
import { type ReactNode } from 'react';
import { detectPlatformContext } from '@core/primitives/keybindings/api';
import { Button } from '@core/primitives/ui/browser/button';
import { cn } from '@core/primitives/ui/browser/cn';
import { NavButtons } from '@core/primitives/ui/browser/components/nav-buttons';
import { BoundShortcut } from '@core/primitives/ui/browser/shortcut';
import { Tooltip, TooltipContent, TooltipTrigger } from '@core/primitives/ui/browser/tooltip';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { WindowControls } from './window-controls';

const platform = detectPlatformContext().os;
const isMac = platform === 'mac';
const isLinux = platform === 'linux';

export function Titlebar({ leftSlot, rightSlot }: { leftSlot?: ReactNode; rightSlot?: ReactNode }) {
  const { setCollapsed, isLeftOpen } = useWorkspaceLayoutContext();
  return (
    <header
      className={cn(
        'flex h-10 shrink-0 items-center bg-background-secondary border-b border-border [-webkit-app-region:drag] dark:bg-background',
        // macOS traffic lights sit at the top-left, so clear room only there.
        !isLeftOpen && isMac && 'pl-18',
        // Linux draws its own controls flush to the right corner (no native
        // frame); everywhere else keep the normal right padding.
        isLinux ? 'pr-0' : 'pr-2'
      )}
    >
      <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-1">
        {!isLeftOpen && <div className="[-webkit-app-region:no-drag]"></div>}
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center justify-start [-webkit-app-region:no-drag]">
            {!isLeftOpen && (
              <div className="ml-2 flex items-center gap-0.5 [-webkit-app-region:no-drag]">
                <Tooltip>
                  <TooltipTrigger>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-7 p-0"
                      onClick={() => setCollapsed('left', isLeftOpen)}
                    >
                      <PanelLeft className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Toggle left sidebar
                    <BoundShortcut command="workbench.toggleLeftSidebar" variant="keycaps" />
                  </TooltipContent>
                </Tooltip>
                <NavButtons />
              </div>
            )}
            {leftSlot}
          </div>
          <div className="flex items-center justify-end gap-1 [-webkit-app-region:no-drag]">
            {rightSlot}
          </div>
        </div>
      </div>
      {isLinux && <WindowControls />}
    </header>
  );
}
