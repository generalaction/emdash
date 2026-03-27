import { FileDiff, Files, GitCommit, ListTree, MessageSquare, Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Titlebar } from '@renderer/components/titlebar/Titlebar';
import { ShortcutHint } from '@renderer/components/ui/shortcut-hint';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import {
  asProvisioned,
  getTaskStore,
  taskDisplayName,
  taskViewKind,
} from '@renderer/core/stores/task-selectors';
import { RightPanelView } from '@renderer/core/tasks/types';
import { useDelayedBoolean } from '@renderer/hooks/use-delay-boolean';
import { useTaskViewNavigation } from './hooks/use-task-view-navigation';
import { useTaskViewShortcuts } from './hooks/use-task-view-shortcuts';
import { useTaskViewContext } from './task-view-context';

export const TaskTitlebar = observer(function TaskTitlebar() {
  const { projectId, taskId } = useTaskViewContext();
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);

  const isNotReady =
    kind === 'creating' ||
    kind === 'create-error' ||
    kind === 'provisioning' ||
    kind === 'provision-error';

  if (isNotReady) {
    return <PendingTaskTitlebar name={taskDisplayName(taskStore)} />;
  }

  return <ActiveTaskTitlebar taskId={taskId} />;
});

function PendingTaskTitlebar({ name }: { name?: string }) {
  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center gap-1 px-2">
          <span className="text-sm text-muted-foreground">{name}</span>
        </div>
      }
    />
  );
}

const ActiveTaskTitlebar = observer(function ActiveTaskTitlebar({ taskId }: { taskId: string }) {
  const { projectId } = useTaskViewContext();
  const taskStore = getTaskStore(projectId, taskId);
  const taskState = asProvisioned(taskStore)!;
  const { view, rightPanelView } = taskState;
  const { openAgentsView, openEditorView, openDiffView, isPending } = useTaskViewNavigation();
  const delayedIsPending = useDelayedBoolean(isPending, 200);
  useTaskViewShortcuts();

  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center gap-1 px-2">
          <span className="text-sm text-muted-foreground">{taskDisplayName(taskStore)}</span>
        </div>
      }
      rightSlot={
        <div className="flex items-center gap-2 mr-2">
          <ToggleGroup
            disabled={delayedIsPending}
            variant="outline"
            value={[view]}
            size="sm"
            onValueChange={([value]) => {
              if (value === 'agents') openAgentsView();
              if (value === 'editor') openEditorView();
              if (value === 'diff') openDiffView();
            }}
          >
            <Tooltip>
              <TooltipTrigger>
                <ToggleGroupItem value="agents" size="sm">
                  <MessageSquare className="size-3.5" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>
                <div className="flex flex-col gap-1">
                  <span>Conversations view</span>
                  <ShortcutHint settingsKey="taskViewAgents" />
                </div>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger>
                <ToggleGroupItem value="diff" size="sm">
                  <FileDiff className="size-3.5" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>
                <div className="flex flex-col gap-1">
                  <span>Diff view</span>
                  <ShortcutHint settingsKey="taskViewDiff" />
                </div>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger>
                <ToggleGroupItem value="editor" size="sm">
                  <Files className="size-3.5" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>
                <div className="flex flex-col gap-1">
                  <span>File view</span>
                  <ShortcutHint settingsKey="taskViewEditor" />
                </div>
              </TooltipContent>
            </Tooltip>
          </ToggleGroup>
          <ToggleGroup
            disabled={delayedIsPending}
            variant="outline"
            value={[rightPanelView]}
            size="sm"
            onValueChange={([value]) => {
              if (!value) return;
              taskState.setRightPanelView(value as RightPanelView);
            }}
          >
            <Tooltip>
              <TooltipTrigger>
                <ToggleGroupItem value="changes" size="sm">
                  <GitCommit className="size-3.5" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>Git changes</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger>
                <ToggleGroupItem value="terminals" size="sm">
                  <Terminal className="size-3.5" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>Terminals</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger>
                <ToggleGroupItem value="files" size="sm">
                  <ListTree className="size-3.5" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>File explorer</TooltipContent>
            </Tooltip>
          </ToggleGroup>
        </div>
      }
    />
  );
});
