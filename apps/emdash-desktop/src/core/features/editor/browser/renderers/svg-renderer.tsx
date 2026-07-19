import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import { useTaskComposition } from '@core/features/workbench/browser/task-composition-context';
import { ContainedImage } from '@renderer/lib/ui/contained-image';
import { modelRegistry } from '../monaco/monaco-model-registry';
import { buildMonacoModelPath } from '../monaco/monacoModelPath';

interface SvgRendererProps {
  filePath: string;
}

/**
 * Renders an SVG file as an image preview.
 * The source/preview toggle lives in the FileContent container above this component.
 */
export const SvgRenderer = observer(function SvgRenderer({ filePath }: SvgRendererProps) {
  const { editorView } = useTaskComposition();
  const bufferUri = buildMonacoModelPath(editorView.modelRootPath, filePath);

  // Touch bufferVersions so this observer re-renders when the buffer is first
  // populated — otherwise the preview can stick on an empty src.
  void modelRegistry.bufferVersions.get(bufferUri);
  const content = modelRegistry.getValue(bufferUri) ?? '';
  const svgUrl = useMemo(
    () => (content ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}` : ''),
    [content]
  );
  const fileName = filePath.split('/').pop() ?? filePath;

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-4">
      {svgUrl ? (
        <ContainedImage src={svgUrl} alt={fileName} className="max-h-full max-w-full" />
      ) : (
        <div className="text-xs text-foreground-passive">Loading…</div>
      )}
    </div>
  );
});
