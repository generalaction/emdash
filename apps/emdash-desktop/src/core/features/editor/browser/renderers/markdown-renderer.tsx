import { observer } from 'mobx-react-lite';
import { useCallback } from 'react';
import { readEditorImage } from '@core/features/editor/api/browser/files';
import { modelRegistry } from '@core/features/editor/api/browser/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@core/features/editor/api/browser/monaco/monacoModelPath';
import { resolveWorkspaceResourcePath } from '@core/features/editor/api/browser/renderers/workspace-resource-path';
import type { FileTabResource } from '@core/features/editor/api/browser/task-editor/stores/file-tab-resource';
import {
  useTaskComposition,
  useWorkspace,
} from '@core/features/workbench/api/browser/task-composition-context';
import { MarkdownRenderer } from '@core/primitives/ui/browser/markdown-renderer';
import { Spinner } from '@core/primitives/ui/browser/spinner';
import { usePaneContext } from '@core/primitives/workbench-shell/browser/tabs/pane-context';
import { useDelayedBoolean } from '@renderer/lib/hooks/use-delay-boolean';

interface MarkdownEditorRendererProps {
  tab: FileTabResource;
}

/**
 * Renders a markdown file as a formatted preview.
 * The source/preview toggle lives in the FileContent container above this component.
 */
export const MarkdownEditorRenderer = observer(function MarkdownEditorRenderer({
  tab,
}: MarkdownEditorRendererProps) {
  const workspace = useWorkspace();
  const workspacePath = workspace.path;
  const { editorView } = useTaskComposition();
  const { pane } = usePaneContext();
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
      const result = await readEditorImage(workspace.workspaceId, workspacePath, imagePath);
      return result.success && !result.data.truncated ? result.data.dataUrl : null;
    },
    [workspace.workspaceId, workspacePath, tab.path]
  );

  const openWorkspaceLink = useCallback(
    (href: string): boolean => {
      const target = resolveWorkspaceResourcePath({
        workspacePath,
        containingFilePath: tab.path,
        resourcePath: href,
      });
      if (!target) return false;
      pane.open('file', { path: target }, { preview: false });
      return true;
    },
    [workspacePath, tab.path, pane]
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
          onOpenLink={tab.isExternal ? undefined : openWorkspaceLink}
        />
      )}
    </div>
  );
});
