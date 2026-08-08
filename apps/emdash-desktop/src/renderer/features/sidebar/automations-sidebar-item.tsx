import { CheckCheck, Clock } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import {
  useAutomationUnreadCount,
  useMarkAutomationsRead,
} from '@renderer/features/automations/use-automation-unread-count';
import { toast } from '@renderer/lib/hooks/use-toast';
import {
  isCurrentView,
  useNavigate,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { cn } from '@renderer/utils/utils';
import { SidebarMenuAction, SidebarMenuRow } from './sidebar-primitives';

function formatUnreadCount(count: number): string {
  if (count > 99) return '99+';
  return String(count);
}

export const AutomationsSidebarItem = observer(function AutomationsSidebarItem() {
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();
  const unreadCount = useAutomationUnreadCount();
  const markAsRead = useMarkAutomationsRead();
  const isActive = isCurrentView(currentView, 'automations');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (unreadCount === 0) setMenuOpen(false);
  }, [unreadCount]);

  async function handleMarkAsRead() {
    try {
      await markAsRead();
      setMenuOpen(false);
    } catch {
      toast({
        title: 'Could not mark as read',
        description: 'Your read state could not be saved. Please try again.',
        variant: 'destructive',
      });
    }
  }

  return (
    <ContextMenu
      open={menuOpen}
      onOpenChange={(open) => {
        if (open && unreadCount === 0) return;
        setMenuOpen(open);
      }}
    >
      <ContextMenuTrigger className="w-full">
        <SidebarMenuRow
          isActive={isActive}
          aria-label="Automations"
          className="w-full justify-between"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => navigate('automations')}
        >
          <SidebarMenuAction aria-label="Automations" className="gap-2">
            <Clock className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" />
            <span className="truncate">Automations</span>
          </SidebarMenuAction>
          {unreadCount > 0 ? (
            <span
              aria-label={`${unreadCount} unread automation run${unreadCount === 1 ? '' : 's'}`}
              className={cn(
                'ml-2 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full',
                'bg-background-tertiary-2 px-1.5 text-[10px] font-medium tabular-nums text-foreground-tertiary'
              )}
            >
              {formatUnreadCount(unreadCount)}
            </span>
          ) : null}
        </SidebarMenuRow>
      </ContextMenuTrigger>
      <ContextMenuContent side="bottom" align="start">
        <ContextMenuItem onClick={() => void handleMarkAsRead()}>
          <CheckCheck className="size-4" />
          Mark all as read
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
