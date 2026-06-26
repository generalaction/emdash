import { observer } from 'mobx-react-lite';
import { relativeToWorkspace } from '@renderer/features/tasks/stores/workspace-path';
import { useWorkspace } from '@renderer/features/tasks/task-view-context';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import type { FileTabStore } from './stores/file-tab-store';

interface FileContentToolbarProps {
  tab: FileTabStore;
  canToggle: boolean;
}

/** Top bar shown on every file tab: file path on the left, Preview/Source tabs on the right. */
export const FileContentToolbar = observer(function FileContentToolbar({
  tab,
  canToggle,
}: FileContentToolbarProps) {
  const workspace = useWorkspace();
  const displayPath = relativeToWorkspace(workspace.path, tab.path);
  return (
    <div className="flex h-[41px] shrink-0 items-center justify-between gap-2 border-b border-border bg-background-secondary-1 px-2">
      <span className="min-w-0 flex-1 truncate text-xs text-foreground-passive" title={tab.path}>
        {displayPath}
      </span>
      {canToggle && (
        <ToggleGroup
          size="sm"
          multiple={false}
          value={[tab.viewMode]}
          onValueChange={([value]) => {
            if (value === 'preview' || value === 'source') tab.setViewMode(value);
          }}
        >
          <ToggleGroupItem value="preview" className="text-xs">
            Preview
          </ToggleGroupItem>
          <ToggleGroupItem value="source" className="text-xs">
            Source
          </ToggleGroupItem>
        </ToggleGroup>
      )}
    </div>
  );
});
