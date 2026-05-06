import { Pencil } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';

interface SvgRendererProps {
  filePath: string;
}

/**
 * Renders an SVG file as an image.
 * A floating "Edit source" button in the top-right corner toggles to Monaco source view.
 */
export function SvgRenderer({ filePath }: SvgRendererProps) {
  const editorView = useProvisionedTask().taskView.editorView;

  const content =
    modelRegistry.getValue(buildMonacoModelPath(editorView.modelRootPath, filePath)) ?? '';

  const svgUrl = useMemo(
    () => (content ? URL.createObjectURL(new Blob([content], { type: 'image/svg+xml' })) : ''),
    [content]
  );

  useEffect(() => {
    return () => {
      if (svgUrl) URL.revokeObjectURL(svgUrl);
    };
  }, [svgUrl]);

  const fileName = filePath.split('/').pop() ?? filePath;

  return (
    <div className="relative flex h-full items-center justify-center overflow-auto p-4">
      <img src={svgUrl} alt={fileName} className="max-h-full max-w-full object-contain" />
      <button
        className="absolute right-3 top-3 z-10 rounded p-1 bg-background/80 hover:bg-accent text-muted-foreground hover:text-foreground"
        onClick={() => editorView.updateRenderer(filePath, () => ({ kind: 'svg-source' }))}
        title="Edit source"
        aria-label="Edit source"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
