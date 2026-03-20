import {
  BotIcon,
  FileDiff,
  Files,
  GitCommit,
  ListTree,
  MessageSquare,
  Terminal,
} from 'lucide-react';
import { Titlebar } from '@renderer/components/titlebar/Titlebar';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
import { useTaskViewNavigation } from './hooks/use-task-view-navigation';
import { RightPanelView, useReadyTaskViewContext, useTaskViewContext } from './task-view-context';

export function TaskTitlebar() {
  const { taskStatus } = useTaskViewContext();
  if (taskStatus.status === 'pending') {
    return <PendingTaskTitlebar name={taskStatus.pendingTask?.name} />;
  }
  if (taskStatus.status === 'bootstrapping' || taskStatus.status === 'error') {
    return <PendingTaskTitlebar />;
  }
  return <ActiveTaskTitlebar />;
}

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

function ActiveTaskTitlebar() {
  const { view, task, rightPanelView, setRightPanelView } = useReadyTaskViewContext();
  const { openAgentsView, openEditorView, openDiffView } = useTaskViewNavigation();

  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center gap-1 px-2">
          <span className="text-sm text-muted-foreground">{task.name}</span>
          {/* <OpenInMenu path={'/'} align="right" /> */}
        </div>
      }
      rightSlot={
        <>
          <ToggleGroup
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
            variant="outline"
            value={[rightPanelView]}
            size="sm"
            className="rounded-lg overflow-hidden shadow-none h-7 border border-border mx-1 mr-2"
            onValueChange={([value]) => {
              if (!value) return;
              setRightPanelView(value as RightPanelView);
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
}
