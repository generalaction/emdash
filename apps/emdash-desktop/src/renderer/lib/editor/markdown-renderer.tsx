import { observer } from 'mobx-react-lite';
import { useCallback } from 'react';
import type { FileTabStore } from '@renderer/features/tasks/editor/stores/file-tab-store';
import {
  useTaskViewContext,
  useWorkspace,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { useDelayedBoolean } from '@renderer/lib/hooks/use-delay-boolean';
import { rpc } from '@renderer/lib/ipc';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { Spinner } from '@renderer/lib/ui/spinner';
import { resolveWorkspaceResourcePath } from './workspace-resource-path';

interface MarkdownEditorRendererProps {
  tab: FileTabStore;
}

/**
 * Renders a markdown file as a formatted preview.
 * The source/preview toggle lives in the FileContent container above this component.
 */
export const MarkdownEditorRenderer = observer(function MarkdownEditorRenderer({
  tab,
}: MarkdownEditorRendererProps) {
  const { projectId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const workspacePath = useWorkspace().path;
  const { editorView } = useWorkspaceViewModel();
  const showExternalSpinner = useDelayedBoolean(!!(tab.isExternal && tab.isLoading), 200);
  const bufferUri = tab.isExternal ? '' : buildMonacoModelPath(editorView.modelRootPath, tab.path);

  // Reading bufferVersions creates a MobX tracking dependency so this observer
  // component re-renders whenever the buffer content changes or is first populated.
  const _version = bufferUri ? modelRegistry.bufferVersions.get(bufferUri) : undefined;
  const content = tab.isExternal ? tab.content : (modelRegistry.getValue(bufferUri) ?? '');

  const resolveImage = useCallback(
    async (src: string): Promise<string | null> => {
      const imagePath = resolveWorkspaceResourcePath({
        workspacePath,
        containingFilePath: tab.path,
        resourcePath: src,
      });
      if (!imagePath) return null;
      const result = await rpc.workspace.files.readImage(projectId, workspaceId, imagePath);
      return result.success && result.data?.success ? result.data.dataUrl : null;
    },
    [projectId, workspaceId, workspacePath, tab.path]
  );

  return (
    <div className="relative h-full overflow-y-auto bg-background-secondary-1">
      {tab.isExternal && tab.isLoading ? (
        showExternalSpinner ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : null
      ) : tab.isExternal && tab.externalError ? (
        <div className="text-destructive px-8 py-8 text-sm">
          Could not load file: {tab.externalError}
        </div>
      ) : (
        <MarkdownRenderer
          content={content}
          variant="full"
          className="w-full max-w-3xl px-8 py-8"
          resolveImage={tab.isExternal ? undefined : resolveImage}
        />
      )}
    </div>
  );
});
