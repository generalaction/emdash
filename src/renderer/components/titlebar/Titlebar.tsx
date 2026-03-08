import { PanelLeft, PanelRight } from 'lucide-react';
import { ReactNode } from 'react';
import { Toggle } from '@renderer/components/ui/toggle';
import { useWorkspaceLayoutContext } from '@renderer/contexts/WorkspaceLayoutProvider';
import { useWorkspaceSlots } from '@renderer/contexts/WorkspaceViewProvider';
import { cn } from '@renderer/lib/utils';

export function Titlebar({
  leftSlot,
  rightSlot,
  centerSlot,
}: {
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  centerSlot?: ReactNode;
}) {
  const { isRightOpen, setCollapsed, isLeftOpen } = useWorkspaceLayoutContext();
  const { RightPanel } = useWorkspaceSlots();
  return (
    <header
      className={cn(
        'flex h-9 shrink-0 items-center bg-muted pr-2 shadow-[inset_0_-1px_0_hsl(var(--border))] [-webkit-app-region:drag] dark:bg-background',
        !isLeftOpen && 'pl-20'
      )}
    >
      <div className="pointer-events-auto flex w-full items-center gap-1 [-webkit-app-region:no-drag]">
        {!isLeftOpen && <div className="[-webkit-app-region:no-drag]"></div>}
        <div className="grid w-full grid-cols-3">
          <div className="flex items-center justify-start [-webkit-app-region:no-drag]">
            {!isLeftOpen && (
              <Toggle pressed={isLeftOpen} onPressedChange={() => setCollapsed('left', isLeftOpen)}>
                <PanelLeft className="h-4 w-4" />
              </Toggle>
            )}
            {leftSlot}
          </div>
          <div className="flex items-center justify-center [-webkit-app-region:no-drag]">
            {centerSlot}
          </div>
          <div className="flex items-center justify-end [-webkit-app-region:no-drag]">
            {rightSlot}
            <Toggle
              disabled={!RightPanel}
              pressed={isRightOpen}
              onPressedChange={() => setCollapsed('right', isRightOpen)}
            >
              <PanelRight className="h-4 w-4" />
            </Toggle>
          </div>
        </div>
      </div>
    </header>
  );
}
