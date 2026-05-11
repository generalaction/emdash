import { Eye, Pencil } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';

interface SvgRendererProps {
  filePath: string;
}

/**
 * Renders an SVG file as an image.
 */
export const SvgRenderer = observer(function SvgRenderer({ filePath }: SvgRendererProps) {
  const { taskView } = useProvisionedTask();
  const { editorView, tabManager } = taskView;
  const bufferUri = buildMonacoModelPath(editorView.modelRootPath, filePath);

  // Touch bufferVersions so this observer re-renders when the buffer is first
  // populated — otherwise the preview can stick on an empty src.
  void modelRegistry.bufferVersions.get(bufferUri);
  const content = modelRegistry.getValue(bufferUri) ?? '';
  const svgUrl = content ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}` : '';
  const fileName = filePath.split('/').pop() ?? filePath;

  return (
    <div className="relative flex h-full items-center justify-center overflow-auto p-4">
      {svgUrl ? (
        <img src={svgUrl} alt={fileName} className="max-h-full max-w-full object-contain" />
      ) : (
        <div className="text-xs text-foreground-passive">Loading…</div>
      )}
      <ToggleGroup
        value={['svg']}
        onValueChange={(value) => {
          if (value.includes('svg-source')) {
            tabManager.updateRenderer(filePath, () => ({ kind: 'svg-source' }));
          }
        }}
        size="sm"
        className="absolute right-3 top-3 z-10"
      >
        <ToggleGroupItem value="svg" aria-label="View rendered">
          <Eye className="size-3.5" />
        </ToggleGroupItem>
        <ToggleGroupItem value="svg-source" aria-label="Edit source">
          <Pencil className="size-3.5" />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
});
