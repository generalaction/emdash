import { observer } from 'mobx-react-lite';
import { useCallback, useRef } from 'react';
import { usePaneContext } from '@renderer/features/tabs/pane-context';
import type { FileTabResource } from '@renderer/features/tasks/editor/stores/file-tab-resource';
import {
  useTaskViewContext,
  useWorkspace,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { FindOverlay } from '@renderer/lib/find/find-overlay';
import { useDomTextSearch } from '@renderer/lib/find/use-dom-text-search';
import { useDelayedBoolean } from '@renderer/lib/hooks/use-delay-boolean';
import { rpc } from '@renderer/lib/ipc';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { Spinner } from '@renderer/lib/ui/spinner';
import { resolveWorkspaceResourcePath } from './workspace-resource-path';

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
  const { projectId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const workspacePath = useWorkspace().path;
  const { editorView } = useWorkspaceViewModel();
  const { pane } = usePaneContext();
  const showExternalSpinner = useDelayedBoolean(!!(tab.isExternal && tab.isLoading), 200);
  const bufferUri = tab.isExternal ? '' : buildMonacoModelPath(editorView.modelRootPath, tab.path);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const {
    isSearchOpen,
    searchQuery,
    searchStatus,
    searchInputRef,
    closeSearch,
    handleSearchQueryChange,
    stepSearch,
  } = useDomTextSearch({
    containerRef,
    enabled: !tab.isExternal || (!tab.isLoading && !tab.externalError),
    targetId: `markdown-preview-${tab.path}`,
  });

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onMouseDown={() => containerRef.current?.focus()}
      className="relative h-full overflow-y-auto bg-background-secondary-1 outline-none"
    >
      <FindOverlay
        isOpen={isSearchOpen}
        fullWidth
        searchQuery={searchQuery}
        searchStatus={searchStatus}
        searchInputRef={searchInputRef}
        onQueryChange={handleSearchQueryChange}
        onStep={stepSearch}
        onClose={closeSearch}
        placeholder="Find in preview..."
        ariaLabel="Find in preview"
      />
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
