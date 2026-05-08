import { Eye, Pencil } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback } from 'react';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { useDelayedBoolean } from '@renderer/lib/hooks/use-delay-boolean';
import { rpc } from '@renderer/lib/ipc';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { Spinner } from '@renderer/lib/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';

interface MarkdownEditorRendererProps {
  filePath: string;
}

export const MarkdownEditorRenderer = observer(function MarkdownEditorRenderer({
  filePath,
}: MarkdownEditorRendererProps) {
  const { projectId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const { workspaceId } = provisioned;
  const editorView = provisioned.taskView.editorView;
  const tab = editorView.tabs.find((t) => t.path === filePath);
  const showExternalSpinner = useDelayedBoolean(!!(tab?.isExternal && tab.isLoading), 200);

  const fileDir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
  const resolveImage = useCallback(
    async (src: string): Promise<string | null> => {
      const imagePath = fileDir ? `${fileDir}/${src}` : src;
      const result = await rpc.fs.readImage(projectId, workspaceId, imagePath);
      return result.success ? (result.data?.dataUrl ?? null) : null;
    },
    [projectId, workspaceId, fileDir]
  );

  if (tab?.isExternal) {
    return (
      <div className="relative h-full overflow-y-auto bg-background-secondary-1">
        {tab.isLoading ? (
          showExternalSpinner ? (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          ) : null
        ) : tab.externalError ? (
          <div className="px-8 py-8 text-sm text-destructive">
            Could not load file: {tab.externalError}
          </div>
        ) : (
          <MarkdownRenderer content={tab.content} variant="full" className="w-full px-8 py-8" />
        )}
      </div>
    );
  }

  const bufferUri = buildMonacoModelPath(editorView.modelRootPath, filePath);
  // Reading bufferVersions creates a MobX tracking dependency so this observer()
  // component re-renders whenever the buffer content changes or is first populated.

  const _version = modelRegistry.bufferVersions.get(bufferUri);
  const content = modelRegistry.getValue(bufferUri) ?? '';

  return (
    <div className="relative h-full overflow-y-auto bg-background-secondary-1">
      <ToggleGroup
        value={['markdown']}
        onValueChange={(value) => {
          if (value.includes('markdown-source')) {
            editorView.updateRenderer(filePath, () => ({ kind: 'markdown-source' }));
          }
        }}
        size="sm"
        className="sticky top-3 z-10 float-right mr-3"
      >
        <ToggleGroupItem value="markdown" aria-label="Preview">
          <Eye className="h-3.5 w-3.5" />
        </ToggleGroupItem>
        <ToggleGroupItem value="markdown-source" aria-label="Edit source">
          <Pencil className="h-3.5 w-3.5" />
        </ToggleGroupItem>
      </ToggleGroup>
      <MarkdownRenderer
        content={content}
        variant="full"
        className="w-full px-8 py-8"
        resolveImage={resolveImage}
      />
    </div>
  );
});
