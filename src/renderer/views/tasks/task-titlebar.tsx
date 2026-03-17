import { BotIcon, FileDiff, Files } from 'lucide-react';
import { Titlebar } from '@renderer/components/titlebar/Titlebar';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
import { useTaskViewNavigation } from './hooks/use-task-view-navigation';
import { useReadyTaskViewContext, useTaskViewContext } from './task-view-context';

export function TaskTitlebar() {
  const { taskStatus } = useTaskViewContext();
  if (taskStatus.status === 'pending') {
    return <PendingTaskTitlebar name={taskStatus.pendingTask?.name} />;
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
  const { view, setView, task } = useReadyTaskViewContext();
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
        <ToggleGroup
          variant="outline"
          value={[view]}
          size="sm"
          className="rounded-lg overflow-hidden shadow-none h-7 border border-border mx-2"
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
            <BotIcon className="size-3.5" />
          </ToggleGroupItem>
          <ToggleGroupItem
            value="editor"
            size="sm"
            className="border-none rounded-md data-pressed:text-foreground text-muted-foreground size-7 px-1"
          >
            <Files className="size-3.5" />
          </ToggleGroupItem>
          <ToggleGroupItem
            value="diff"
            size="sm"
            className="border-none data-pressed:text-foreground text-muted-foreground size-7 px-1"
          >
            <FileDiff className="size-3.5" />
          </ToggleGroupItem>
        </ToggleGroup>
      }
    />
  );
}
