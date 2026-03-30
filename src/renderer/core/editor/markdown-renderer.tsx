import { Pencil } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { MarkdownRenderer } from '@renderer/components/ui/markdown-renderer';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/core/monaco/monacoModelPath';
import { useRequireProvisionedTask } from '@renderer/views/tasks/task-view-context';

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
  const editorView = useRequireProvisionedTask().editorView;
  const bufferUri = buildMonacoModelPath(editorView.modelRootPath, filePath);
  // Reading bufferVersions creates a MobX tracking dependency so this observer()
  // component re-renders whenever the buffer content changes or is first populated.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _version = modelRegistry.bufferVersions.get(bufferUri);
  const content = modelRegistry.getValue(bufferUri) ?? '';
  const fileDir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';

  return (
    <div className="relative h-full overflow-y-auto">
      <MarkdownRenderer
        content={content}
        variant="full"
        className="w-full max-w-3xl px-8 py-8"
        rootPath={editorView.modelRootPath}
        fileDir={fileDir}
      />

      <button
        className="absolute right-3 top-3 z-10 rounded p-1 bg-background/80 hover:bg-accent text-muted-foreground hover:text-foreground"
        onClick={() => editorView.updateRenderer(filePath, () => ({ kind: 'markdown-source' }))}
        title="Edit source"
        aria-label="Edit source"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
});
