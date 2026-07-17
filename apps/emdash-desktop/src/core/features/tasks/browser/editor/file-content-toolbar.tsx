import { observer } from 'mobx-react-lite';
import { relativeToWorkspace } from '@core/features/tasks/browser/stores/workspace-path';
import { useWorkspace } from '@core/features/tasks/browser/task-view-context';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import type { FileTabResource } from './stores/file-tab-resource';

interface FileContentToolbarProps {
  tab: FileTabResource;
  canToggle: boolean;
}

/** Top bar shown on every file tab: file path on the left, Raw/Preview tabs on the right. */
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
          <ToggleGroupItem value="source" className="text-xs">
            Raw
          </ToggleGroupItem>
          <ToggleGroupItem value="preview" className="text-xs">
            Preview
          </ToggleGroupItem>
        </ToggleGroup>
      )}
    </div>
  );
});
