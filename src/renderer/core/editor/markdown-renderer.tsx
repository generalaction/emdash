import { Pencil } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { MarkdownPreview } from '@renderer/components/FileExplorer/MarkdownPreview';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/core/monaco/monacoModelPath';
import { useEditorContext } from '@renderer/views/tasks/editor/editor-provider';
import { useOpenedFile } from './use-opened-file';

interface MarkdownEditorRendererProps {
  filePath: string;
}

/**
 * Renders a markdown file as a formatted preview.
 * A floating "Edit source" button in the top-right corner toggles to Monaco source view.
 */
export const MarkdownEditorRenderer = observer(function MarkdownEditorRenderer({
  filePath,
}: MarkdownEditorRendererProps) {
  const { modelRootPath } = useEditorContext();
  const { updateRenderer } = useOpenedFile(filePath);
  const bufferUri = buildMonacoModelPath(modelRootPath, filePath);
  const content = modelRegistry.getValue(bufferUri) ?? '';
  const fileDir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';

  return (
    <div className="relative h-full">
      <MarkdownPreview content={content} rootPath={modelRootPath} fileDir={fileDir} />
      <button
        className="absolute right-3 top-3 z-10 rounded p-1 bg-background/80 hover:bg-accent text-muted-foreground hover:text-foreground"
        onClick={() => updateRenderer(() => ({ kind: 'markdown-source' }))}
        title="Edit source"
        aria-label="Edit source"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
});
