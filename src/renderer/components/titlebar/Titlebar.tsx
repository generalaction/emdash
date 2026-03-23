import { PanelLeft, PanelRight } from 'lucide-react';
import { ReactNode } from 'react';
import { Toggle } from '@renderer/components/ui/toggle';
import { useWorkspaceLayoutContext } from '@renderer/core/view/layout-provider';
import { useWorkspaceSlots } from '@renderer/core/view/navigation-provider';
import { cn } from '@renderer/lib/utils';

export function Titlebar({ leftSlot, rightSlot }: { leftSlot?: ReactNode; rightSlot?: ReactNode }) {
  const { isRightOpen, setCollapsed, isLeftOpen } = useWorkspaceLayoutContext();
  const { RightPanel } = useWorkspaceSlots();
  return (
    <header
      className={cn(
        'flex h-10 shrink-0 items-center pr-2 border-b border-border [-webkit-app-region:drag] dark:bg-background',
        !isLeftOpen && 'pl-17'
      )}
    >
      <div className="pointer-events-auto flex w-full items-center gap-1">
        {!isLeftOpen && <div className="[-webkit-app-region:no-drag]"></div>}
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center justify-start [-webkit-app-region:no-drag]">
            {!isLeftOpen && (
              <Toggle pressed={isLeftOpen} onPressedChange={() => setCollapsed('left', isLeftOpen)}>
                <PanelLeft className="h-4 w-4" />
              </Toggle>
            )}
            {leftSlot}
          </div>
          <div className="flex items-center justify-end [-webkit-app-region:no-drag]">
            {rightSlot}
            <Toggle
              disabled={!RightPanel}
              pressed={isRightOpen}
              size="sm"
              className="rounded-lg data-pressed:bg-muted size-7 w-7 border border-border data-pressed:text-foreground text-muted-foreground"
              onPressedChange={() => setCollapsed('right', isRightOpen)}
            >
              <PanelRight className="size-3.5" />
            </Toggle>
          </div>
        </div>
      </div>
    </header>
  );
}
