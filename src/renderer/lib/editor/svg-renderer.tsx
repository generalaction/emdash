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
 * A floating "Edit source" button in the top-right corner toggles to Monaco source view.
 */
export const SvgRenderer = observer(function SvgRenderer({ filePath }: SvgRendererProps) {
  const editorView = useProvisionedTask().taskView.editorView;
  const bufferUri = buildMonacoModelPath(editorView.modelRootPath, filePath);

  // Reading bufferVersions creates a MobX tracking dependency so this observer()
  // component re-renders when the buffer is first populated. Without this, SVG
  // preview can render once with an empty src and stay as a broken image until
  // some unrelated navigation causes a re-render.
  const _version = modelRegistry.bufferVersions.get(bufferUri);
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
            editorView.updateRenderer(filePath, () => ({ kind: 'svg-source' }));
          }
        }}
        size="sm"
        className="absolute right-3 top-3 z-10"
      >
        <ToggleGroupItem value="svg" aria-label="View rendered">
          <Eye className="h-3.5 w-3.5" />
        </ToggleGroupItem>
        <ToggleGroupItem value="svg-source" aria-label="Edit source">
          <Pencil className="h-3.5 w-3.5" />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
});
