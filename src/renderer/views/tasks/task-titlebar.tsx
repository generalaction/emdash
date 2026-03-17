import { Brain, FileBracesCorner, GitBranch } from 'lucide-react';
import OpenInMenu from '@renderer/components/titlebar/OpenInMenu';
import { Titlebar } from '@renderer/components/titlebar/Titlebar';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
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

  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center gap-1 px-2">
          <span className="text-sm text-muted-foreground">{task.name}</span>
        </div>
      }
      rightSlot={
        <>
          <ToggleGroup
            variant="outline"
            value={[view]}
            onValueChange={(value) => {
              if (value[0]) setView(value[0] as 'agents' | 'editor' | 'diff');
            }}
          >
            <ToggleGroupItem value="agents">
              <Brain className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="editor">
              <FileBracesCorner className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="diff">
              <GitBranch className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
          <OpenInMenu path={'/'} align="right" />
        </>
      }
    />
  );
}
