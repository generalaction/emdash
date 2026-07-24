import { Columns2, FileSearch, MessageSquarePlus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTaskViewContext } from '@core/features/tasks/api/browser/task-state/task-view-context';
import {
  useTaskComposition,
  useWorkspaceId,
} from '@core/features/workbench/api/browser/task-composition-context';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { Button } from '@core/primitives/ui/browser/button';
import { BoundShortcut } from '@core/primitives/ui/browser/shortcut';
import { Tooltip, TooltipContent, TooltipTrigger } from '@core/primitives/ui/browser/tooltip';
import { usePaneContext } from '@core/primitives/workbench-shell/browser/tabs/pane-context';

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
