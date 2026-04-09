import { PanelLeft, PanelRight } from 'lucide-react';
import { ReactNode } from 'react';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Toggle } from '@renderer/lib/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

export function Titlebar({ leftSlot, rightSlot }: { leftSlot?: ReactNode; rightSlot?: ReactNode }) {
  const { isRightOpen, setCollapsed, isLeftOpen } = useWorkspaceLayoutContext();
  const { RightPanel } = useWorkspaceSlots();
  return (
    <header
      className={cn(
        'flex h-10 shrink-0 items-center bg-background-1 pr-2 border-b border-border [-webkit-app-region:drag] dark:bg-background',
        !isLeftOpen && 'pl-17'
      )}
    >
      <div className="pointer-events-auto flex w-full items-center gap-1">
        {!isLeftOpen && <div className="[-webkit-app-region:no-drag]"></div>}
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center justify-start [-webkit-app-region:no-drag]">
            {!isLeftOpen && (
              <Tooltip>
                <TooltipTrigger>
                  <Toggle
                    pressed={isLeftOpen}
                    variant="outline"
                    size="sm"
                    className="ml-2 size-7"
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
            )}
            {leftSlot}
          </div>
          <div className="flex items-center justify-end [-webkit-app-region:no-drag]">
            {rightSlot}
            <Tooltip>
              <TooltipTrigger>
                <Toggle
                  disabled={!RightPanel}
                  pressed={isRightOpen}
                  size="sm"
                  variant="outline"
                  onPressedChange={() => setCollapsed('right', isRightOpen)}
                >
                  <PanelRight className="size-3.5" />
                </Toggle>
              </TooltipTrigger>
              <TooltipContent>
                Toggle right sidebar
                <ShortcutHint settingsKey="toggleRightSidebar" />
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </header>
  );
}
