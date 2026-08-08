import { Markdown } from '@emdash/ui/react/components';
import { Spinner } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useCallback } from 'react';
import { readEditorImage } from '@core/features/editor/api/browser/files';
import { resolveWorkspaceResourcePath } from '@core/features/editor/api/browser/renderers/workspace-resource-path';
import type { FileTabResource } from '@core/features/editor/api/browser/task-editor/stores/file-tab-resource';
import { useWorkspace } from '@core/features/workbench/api/browser/task-composition-context';
import { useMarkdownLinkOpener } from '@core/primitives/external-links/browser';
import { useDelayedBoolean } from '@core/primitives/react-hooks/browser/use-delay-boolean';
import { usePaneContext } from '@core/primitives/workbench-shell/browser/tabs/pane-context';

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
  const { pane } = usePaneContext();
  const showExternalSpinner = useDelayedBoolean(!!(tab.isExternal && tab.isLoading), 200);

  // Reading bufferVersion creates a MobX tracking dependency so this observer
  // component re-renders whenever the buffer content changes or is first populated.
  void tab.bufferVersion;
  const content = tab.isExternal ? tab.content : tab.bufferText();

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

  const openLink = useMarkdownLinkOpener(tab.isExternal ? undefined : openWorkspaceLink);

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
        <Markdown
          content={content}
          variant="full"
          className="w-full max-w-3xl px-8 py-8"
          resolveImage={tab.isExternal ? undefined : resolveImage}
          onOpenLink={openLink}
        />
      )}
    </div>
  );
});
