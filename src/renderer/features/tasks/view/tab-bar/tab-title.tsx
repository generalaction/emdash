import { observer } from 'mobx-react-lite';
import { cn } from '@renderer/utils/utils';
import { useTabGroupContext } from '../../tabs/tab-group-context';
import { useWorkspaceViewModel } from '../../task-view-context';

export const TabTitle = observer(function TabTitle({
  isActive,
  isPreview,
  hasError,
  maxWidth = 'max-w-[200px]',
  className,
  children,
}: {
  isActive: boolean;
  isPreview?: boolean;
  hasError?: boolean;
  maxWidth?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { groupId } = useTabGroupContext();
  const { focusedRegion, tabGroupManager } = useWorkspaceViewModel();
  const isFocused = focusedRegion === 'main' && tabGroupManager.activeGroupId === groupId;

  return (
    <span
      className={cn(
        'truncate p-1 text-sm opacity-85 group-hover:opacity-100 transition-opacity',
        maxWidth,
        isPreview && 'italic',
        isActive && isFocused && 'opacity-100',
        hasError && 'text-foreground-destructive',
        className
      )}
    >
      {children}
    </span>
  );
});
