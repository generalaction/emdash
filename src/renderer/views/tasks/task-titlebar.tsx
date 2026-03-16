import { Brain, FileBracesCorner } from 'lucide-react';
import OpenInMenu from '@renderer/components/titlebar/OpenInMenu';
import { Titlebar } from '@renderer/components/titlebar/Titlebar';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
import { useCurrentTask, useCurrentTaskStatus, useTaskViewContext } from './task-view-wrapper';

export function TaskTitlebar() {
  const { status } = useCurrentTaskStatus();
  if (status === 'pending') {
    return <PendingTaskTitlebar />;
  }
  return <ActiveTaskTitlebar />;
}

function PendingTaskTitlebar() {
  return <Titlebar leftSlot={<div className="flex items-center gap-1 px-2" />} />;
}

function ActiveTaskTitlebar() {
  const { view, setView } = useTaskViewContext();
  const { currentTask } = useCurrentTask();
  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center gap-1 px-2">
          <span className="text-sm text-muted-foreground">{currentTask?.name}</span>
        </div>
      }
      rightSlot={
        <>
          <ToggleGroup
            variant="outline"
            value={[view]}
            onValueChange={(value) => setView(value[0] as 'agents' | 'editor')}
          >
            <ToggleGroupItem value="agents">
              <Brain className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="editor">
              <FileBracesCorner className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
          <OpenInMenu path={'/'} align="right" />
        </>
      }
    />
  );
}
