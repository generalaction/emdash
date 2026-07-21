import { FileSearch, MessageSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTaskViewContext } from '@core/features/tasks/api/browser/task-state/task-view-context';
import { useWorkspaceId } from '@core/features/workbench/api/browser/task-composition-context';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { cn } from '@core/primitives/ui/browser/cn';
import { BoundShortcut } from '@core/primitives/ui/browser/shortcut';
import { usePaneContext } from '@core/primitives/workbench-shell/browser/tabs/pane-context';
import { EmdashLogo } from '@renderer/lib/emdash-logo';
import { useArrowKeyNavigation } from '@renderer/lib/hooks/use-arrow-key-navigation';

export function PaneEmptyState() {
  const { projectId, taskId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const { pane } = usePaneContext();
  const openCreateConversationModal = useOpenModal('createConversationModal');
  const openCommandPalette = useOpenModal('commandPaletteModal');

  const actions = [
    () => {
      void (async () => {
        const outcome = await openCreateConversationModal({ projectId, taskId });
        if (!outcome.success) return;
        const { conversationId, type } = outcome.data;
        if (type === 'acp') {
          pane.open('acp-chat', { conversationId, preview: false });
        } else {
          pane.open('conversation', { conversationId, preview: false });
        }
      })();
    },
    () => {
      void openCommandPalette({ projectId, taskId, workspaceId });
    },
  ];

  const { selectedIndex, setSelectedIndex } = useArrowKeyNavigation(actions.length, (index) =>
    actions[index]()
  );

  return (
    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3">
      <EmdashLogo height={32} className="text-background-2" />
      <div className="mx-auto mt-10 flex w-full max-w-xs flex-col gap-0.5">
        <PaneEmptyStateAction
          isSelected={selectedIndex === 0}
          onMouseEnter={() => setSelectedIndex(0)}
          onClick={actions[0]}
          icon={<MessageSquare className="size-3.5" />}
          label="New conversation"
          commandId="task.newConversation"
        />
        <PaneEmptyStateAction
          isSelected={selectedIndex === 1}
          onMouseEnter={() => setSelectedIndex(1)}
          onClick={actions[1]}
          icon={<FileSearch className="size-3.5" />}
          label="Open file"
          commandId="app.commandPalette"
        />
      </div>
    </div>
  );
}

function PaneEmptyStateAction({
  icon,
  label,
  commandId,
  isSelected,
  onClick,
  onMouseEnter,
}: {
  icon: ReactNode;
  label: string;
  commandId: string;
  isSelected?: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  return (
    <button
      data-slot="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={cn(
        'flex items-center justify-between  gap-2 text-foreground-muted hover:text-foreground transition-colors hover:bg-background-1 py-2 px-3 rounded-md',
        isSelected && 'bg-background-1 text-foreground'
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        {icon}
        {label}
      </div>
      <BoundShortcut command={commandId} variant="keycaps" />
    </button>
  );
}
