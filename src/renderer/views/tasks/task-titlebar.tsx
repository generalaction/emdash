import { FileDiff, Files, GitCommit, ListTree, MessageSquare, Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Titlebar } from '@renderer/components/titlebar/Titlebar';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
import { RightPanelView } from '@renderer/core/tasks/types';
import { taskViewStateStore } from '@renderer/core/tasks/view/task-view-store';
import { useDelayedBoolean } from '@renderer/hooks/use-delay-boolean';
import { useTaskViewNavigation } from './hooks/use-task-view-navigation';
import { useTaskViewContext } from './task-view-context';
import { getTaskStore, taskDisplayName, taskViewKind } from './task-view-state';

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
  const taskState = taskViewStateStore.getOrCreate(taskId);
  const { view, rightPanelView } = taskState;
  const { openAgentsView, openEditorView, openDiffView, isPending } = useTaskViewNavigation();
  const delayedIsPending = useDelayedBoolean(isPending, 200);

  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center gap-1 px-2">
          <span className="text-sm text-muted-foreground">{taskDisplayName(taskStore)}</span>
        </div>
      }
      rightSlot={
        <>
          <ToggleGroup
            disabled={delayedIsPending}
            variant="outline"
            value={[view]}
            size="sm"
            className="rounded-lg overflow-hidden shadow-none h-7 border border-border mx-1"
            onValueChange={([value]) => {
              if (value === 'agents') openAgentsView();
              if (value === 'editor') openEditorView();
              if (value === 'diff') openDiffView();
            }}
          >
            <ToggleGroupItem
              value="agents"
              size="sm"
              className="data-pressed:bg-muted  border-none rounded-lg data-pressed:text-foreground text-muted-foreground size-7 px-1"
            >
              <MessageSquare className="size-3.5" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="diff"
              size="sm"
              className="border-none data-pressed:text-foreground text-muted-foreground size-7 px-1"
            >
              <FileDiff className="size-3.5" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="editor"
              size="sm"
              className="border-none rounded-md data-pressed:text-foreground text-muted-foreground size-7 px-1"
            >
              <Files className="size-3.5" />
            </ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            disabled={delayedIsPending}
            variant="outline"
            value={[rightPanelView]}
            size="sm"
            className="rounded-lg overflow-hidden shadow-none h-7 border border-border mx-1 mr-2"
            onValueChange={([value]) => {
              if (!value) return;
              taskState.setRightPanelView(value as RightPanelView);
            }}
          >
            <ToggleGroupItem
              value="changes"
              size="sm"
              className="data-pressed:bg-muted  border-none rounded-lg data-pressed:text-foreground text-muted-foreground size-7 px-1"
            >
              <GitCommit className="size-3.5" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="terminals"
              size="sm"
              className="border-none data-pressed:text-foreground text-muted-foreground size-7 px-1"
            >
              <Terminal className="size-3.5" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="files"
              size="sm"
              className="border-none rounded-md data-pressed:text-foreground text-muted-foreground size-7 px-1"
            >
              <ListTree className="size-3.5" />
            </ToggleGroupItem>
          </ToggleGroup>
        </>
      }
    />
  );
});
