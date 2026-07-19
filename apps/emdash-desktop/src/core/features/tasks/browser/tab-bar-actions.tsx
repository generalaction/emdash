import { Columns2, FileSearch, MessageSquarePlus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTaskViewContext } from '@core/features/tasks/browser/task-view-context';
import { usePaneContext } from '@core/features/workbench/browser/tabs/pane-context';
import {
  useTaskComposition,
  useWorkspaceId,
} from '@core/features/workbench/browser/task-composition-context';
import { useOpenModal } from '@renderer/lib/modal/api';
import { Button } from '@renderer/lib/ui/button';
import { BoundShortcut } from '@renderer/lib/ui/shortcut';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

export const TabBarActions = observer(function TabBarActions() {
  const taskView = useTaskComposition();
  const { projectId, taskId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const { pane } = usePaneContext();
  const { paneLayout } = taskView;
  const openCommandPalette = useOpenModal('commandPaletteModal');
  const openCreateConversationModal = useOpenModal('createConversationModal');
  const canSplit = pane.resolvedTabs.length >= 2 && paneLayout.groups.length < 3;

  const handleCreateConversation = () => {
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
  };

  return (
    <div className="flex h-full shrink-0 items-center px-2">
      <Tooltip>
        <TooltipTrigger>
          <Button size="icon-sm" variant="ghost" onClick={handleCreateConversation}>
            <MessageSquarePlus className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          New Conversations <BoundShortcut command="task.newConversation" variant="keycaps" />
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() =>
              void openCommandPalette({
                projectId,
                taskId,
                workspaceId,
              })
            }
          >
            <FileSearch className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open File</TooltipContent>
      </Tooltip>
      {paneLayout.groups.length < 3 && (
        <Tooltip>
          <TooltipTrigger>
            <span>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={!canSplit}
                onClick={() => paneLayout.splitRight()}
                aria-label="Split pane right"
              >
                <Columns2 className="size-3.5" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {canSplit ? (
              <span className="flex items-center gap-2">
                Move active tab to a new pane
                <BoundShortcut command="workbench.splitPane" variant="keycaps" />
              </span>
            ) : (
              'Open at least 2 tabs to split this pane'
            )}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
});
