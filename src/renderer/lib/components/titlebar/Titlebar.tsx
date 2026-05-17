import { PanelLeft } from 'lucide-react';
import { type ReactNode } from 'react';
import { NavButtons } from '@renderer/lib/components/nav-buttons';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { Button } from '@renderer/lib/ui/button';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

export function Titlebar({ leftSlot, rightSlot }: { leftSlot?: ReactNode; rightSlot?: ReactNode }) {
  const { setCollapsed, isLeftOpen } = useWorkspaceLayoutContext();
  return (
    <header
      className={cn(
        'flex h-10 shrink-0 items-center bg-background-secondary pr-2 border-b border-border [-webkit-app-region:drag] dark:bg-background',
        !isLeftOpen && 'pl-18'
      )}
    >
      <div className="pointer-events-auto flex w-full items-center gap-1">
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
                    <ShortcutHint settingsKey="toggleLeftSidebar" />
                  </TooltipContent>
                </Tooltip>
                <NavButtons />
              </div>
            )}
            {leftSlot}
          </div>
          <div className="flex items-center justify-end [-webkit-app-region:no-drag]">
            {rightSlot}
          </div>
        </div>
      </div>
    </header>
  );
}
