import { observer } from 'mobx-react-lite';
import { Separator } from '@renderer/lib/ui/separator';
import { cn } from '@renderer/utils/utils';
import { useTabGroupContext } from '../../tabs/tab-group-context';
import { useWorkspaceViewModel } from '../../task-view-context';
import { DraggableTab } from './draggable-tab';

export function TabDragPreviewShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex cursor-grabbing items-center gap-1.5 rounded-md border border-border bg-background-secondary-1 px-2 py-1 text-sm opacity-80 shadow-lg">
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
  onDoubleClick,
  onClose,
  className,
  innerPaddingRight = 'pr-2',
  children,
}: {
  tabId: string;
  isActive: boolean;
  title: string;
  onSelect: () => void;
  onPin: () => void;
  onDoubleClick?: () => void;
  onClose: () => void;
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
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onDoubleClick={onDoubleClick ?? onPin}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault();
        }}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            onClose();
          }
        }}
        title={title}
        data-tabid={tabId}
        className={cn(
          'group relative flex h-full flex-col bg-background-secondary hover:bg-background-secondary-1 text-sm hover:bg-muted',
          className,
          isActive && 'bg-background-secondary-1 text-foreground-muted',
          isFocused && 'text-foreground'
        )}
      >
        <div className={cn('flex h-full items-center gap-1.5 pl-3', innerPaddingRight)}>
          {children}
        </div>
      </div>
      <Separator orientation="vertical" />
    </DraggableTab>
  );
});
