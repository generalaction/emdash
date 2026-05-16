import { observer } from 'mobx-react-lite';
import { Separator } from '@renderer/lib/ui/separator';
import { cn } from '@renderer/utils/utils';
import { useTabGroupContext } from '../../tabs/tab-group-context';
import { useWorkspaceViewModel } from '../../task-view-context';
import { DraggableTab } from './draggable-tab';

export function TabDragPreviewShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex cursor-grabbing items-center gap-1.5 bg-background-secondary-1 text-sm shadow-lg px-2 py-1 border border-border rounded-md opacity-80">
      {children}
    </div>
  );
}

export const TabItemShell = observer(function TabItemShell({
  tabId,
  isActive,
  title,
  onSelect,
  onPin,
  className,
  innerPaddingRight = 'pr-2',
  children,
}: {
  tabId: string;
  isActive: boolean;
  title: string;
  onSelect: () => void;
  onPin: () => void;
  className?: string;
  activeClassName?: string;
  innerPaddingRight?: string;
  children: React.ReactNode;
}) {
  const { groupId } = useTabGroupContext();
  const { focusedRegion, tabGroupManager } = useWorkspaceViewModel();
  const isFocused = focusedRegion === 'main' && tabGroupManager.activeGroupId === groupId;

  return (
    <DraggableTab id={tabId}>
      <button
        onClick={onSelect}
        onDoubleClick={onPin}
        title={title}
        data-tabid={tabId}
        className={cn(
          'group relative flex h-full flex-col bg-[var(--task-tab-background)] text-sm hover:bg-muted',
          className,
          isActive &&
            'bg-[var(--task-tab-active-background)] hover:bg-[var(--task-tab-active-background)] text-foreground-muted',
          isFocused && 'text-foreground'
        )}
      >
        <div className={cn('flex h-full items-center gap-1.5 pl-3', innerPaddingRight)}>
          {children}
        </div>
      </button>
      <Separator orientation="vertical" />
    </DraggableTab>
  );
});
