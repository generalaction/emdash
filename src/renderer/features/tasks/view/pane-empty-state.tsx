import { FileSearch, MessageSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { EmdashLogo } from '@renderer/lib/emdash-logo';
import { useArrowKeyNavigation } from '@renderer/lib/hooks/use-arrow-key-navigation';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { BoundShortcut } from '@renderer/lib/ui/shortcut';
import { cn } from '@renderer/utils/utils';
import type { ShortcutSettingsKey } from '@shared/shortcuts';
import { useTabGroupContext } from '../tabs/tab-group-context';

export function PaneEmptyState() {
  const { projectId, taskId, workspaceId } = useTaskViewContext();
  const { tabManager } = useTabGroupContext();
  const showCreateConversationModal = useShowModal('createConversationModal');
  const showCommandPalette = useShowModal('commandPaletteModal');

  const actions = [
    () =>
      showCreateConversationModal({
        projectId,
        taskId,
        onSuccess: ({ conversationId }) => tabManager.openConversation(conversationId),
      }),
    () => showCommandPalette({ projectId, taskId, workspaceId: workspaceId ?? undefined }),
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
          shortcutSettingsKey="newConversation"
        />
        <PaneEmptyStateAction
          isSelected={selectedIndex === 1}
          onMouseEnter={() => setSelectedIndex(1)}
          onClick={actions[1]}
          icon={<FileSearch className="size-3.5" />}
          label="Open file"
          shortcutSettingsKey="commandPalette"
        />
      </div>
    </div>
  );
}

function PaneEmptyStateAction({
  icon,
  label,
  shortcutSettingsKey,
  isSelected,
  onClick,
  onMouseEnter,
}: {
  icon: ReactNode;
  label: string;
  shortcutSettingsKey: ShortcutSettingsKey;
  isSelected?: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  return (
    <button
      type="button"
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
      <BoundShortcut settingsKey={shortcutSettingsKey} className="text-foreground-muted" />
    </button>
  );
}
