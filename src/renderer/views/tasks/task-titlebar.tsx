import { Brain, FileBracesCorner } from 'lucide-react';
import OpenInMenu from '@renderer/components/titlebar/OpenInMenu';
import { Titlebar } from '@renderer/components/titlebar/Titlebar';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
import { useTaskViewContext } from './task-view-wrapper';

export function TaskTitlebar() {
  const { view, setView } = useTaskViewContext();

  return (
    <Titlebar
      leftSlot={<span className="text-[13px] font-medium text-muted-foreground">Task name</span>}
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
