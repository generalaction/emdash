import { observer } from 'mobx-react-lite';
import type * as monaco from 'monaco-editor';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { HEAD_REF, STAGED_REF } from '@shared/git';
import type { ActiveFile } from '@shared/view-state';
import { useDiffEditorComments } from '@renderer/features/tasks/diff-view/comments/use-diff-editor-comments';
import { ImageDiffView } from '@renderer/features/tasks/diff-view/main-panel/image-diff-view';
import { getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { useTabGroupContext } from '@renderer/features/tasks/tabs/tab-group-context';
import {
  useTaskViewContext,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { isBinaryForDiff, isImageForDiff } from '@renderer/lib/editor/fileKind';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { StickyDiffEditor } from '@renderer/lib/monaco/sticky-diff-editor';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { getLanguageFromPath } from '@renderer/utils/languageUtils';

export const FileDiffView = observer(function FileDiffView() {
  const { projectId, taskId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const taskView = useWorkspaceViewModel();
  const diffView = taskView.diffView;
  const draftComments = getTaskStore(projectId, taskId)?.draftComments;

  // Derive activeFile from the pane-local active diff tab entry rather than
  // the global DiffViewStore, so each split pane shows its own diff independently.
  const { tabManager } = useTabGroupContext();
  const activeDiffEntry = tabManager.activeDiffEntry;
  const activeFile = useMemo<ActiveFile | null>(
    () =>
      activeDiffEntry
        ? {
            path: activeDiffEntry.path,
            type: activeDiffEntry.diffGroup === 'disk' ? 'disk' : 'git',
            group: activeDiffEntry.diffGroup,
            originalRef: activeDiffEntry.originalRef,
            modifiedRef: activeDiffEntry.modifiedRef,
            prNumber: activeDiffEntry.prNumber,
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      activeDiffEntry?.path,
      activeDiffEntry?.diffGroup,
      activeDiffEntry?.originalRef,
      activeDiffEntry?.modifiedRef,
      activeDiffEntry?.prNumber,
    ]
  );
  const [editor, setEditor] = useState<monaco.editor.IStandaloneDiffEditor | null>(null);

  const isBinary = activeFile ? isBinaryForDiff(activeFile.path) : false;
  const isImage = activeFile ? isImageForDiff(activeFile.path) : false;
  const showEditor = activeFile !== null && !isBinary;
  const activeFilePath = activeFile?.path ?? '';
  const imageDiffKey = activeFile ? `${workspaceId}:${activeFile.group}:${activeFile.path}` : '';

  const comments = activeFilePath ? (draftComments?.getCommentsForFile(activeFilePath) ?? []) : [];

  const handleAddComment = useCallback(
    (lineNumber: number, content: string, lineContent?: string) => {
      if (!activeFilePath || !draftComments) return;
      draftComments.addComment({
        filePath: activeFilePath,
        lineNumber,
        lineContent: lineContent ?? null,
        content,
      });
    },
    [activeFilePath, draftComments]
  );

  const handleEditComment = useCallback(
    (id: string, content: string) => {
      draftComments?.updateComment(id, content);
    },
    [draftComments]
  );

  const handleDeleteComment = useCallback(
    (id: string) => {
      draftComments?.deleteComment(id);
    },
    [draftComments]
  );

  useDiffEditorComments({
    editor: showEditor ? editor : null,
    comments,
    onAddComment: handleAddComment,
    onEditComment: handleEditComment,
    onDeleteComment: handleDeleteComment,
  });

  // Compute URIs from activeFile (same rules as DiffSlotStore).
  const root = `workspace:${workspaceId}`;
  const uri = activeFile ? buildMonacoModelPath(root, activeFile.path) : '';
  const language = activeFile ? getLanguageFromPath(activeFile.path) : '';

  const originalUri = (() => {
    if (!activeFile || !uri) return '';
    if (activeFile.group === 'git' || activeFile.group === 'pr') {
      return modelRegistry.toGitUri(uri, activeFile.originalRef);
    }
    return modelRegistry.toGitUri(uri, HEAD_REF);
  })();

  const modifiedUri = (() => {
    if (!activeFile || !uri) return '';
    if (activeFile.group === 'staged') return modelRegistry.toGitUri(uri, STAGED_REF);
    if (activeFile.group === 'pr') {
      return modelRegistry.toGitUri(uri, activeFile.modifiedRef ?? HEAD_REF);
    }
    if (activeFile.group === 'git') {
      return modelRegistry.toGitUri(uri, HEAD_REF);
    }
    return uri;
  })();

  // Register/unregister models whenever the active file changes.
  useEffect(() => {
    if (!activeFile || isBinary) return;
    let disposed = false;

    if (activeFile.group === 'disk') {
      const diskUri = modelRegistry.toDiskUri(uri);
      void (async () => {
        await modelRegistry.registerModel(
          projectId,
          workspaceId,
          root,
          activeFile.path,
          language,
          'disk'
        );
        if (disposed) {
          modelRegistry.unregisterModel(diskUri);
          return;
        }
        await modelRegistry.registerModel(
          projectId,
          workspaceId,
          root,
          activeFile.path,
          language,
          'buffer'
        );
        if (disposed) {
          modelRegistry.unregisterModel(modifiedUri);
        }
      })().catch(() => {});
      void modelRegistry
        .registerModel(
          projectId,
          workspaceId,
          root,
          activeFile.path,
          language,
          'git',
          activeFile.originalRef
        )
        .catch(() => {});
    } else if (activeFile.group === 'staged') {
      void modelRegistry
        .registerModel(projectId, workspaceId, root, activeFile.path, language, 'git', HEAD_REF)
        .catch(() => {});
      void modelRegistry
        .registerModel(projectId, workspaceId, root, activeFile.path, language, 'git', STAGED_REF)
        .catch(() => {});
    } else {
      void modelRegistry
        .registerModel(
          projectId,
          workspaceId,
          root,
          activeFile.path,
          language,
          'git',
          activeFile.originalRef
        )
        .catch(() => {});
      const effectiveModifiedRef =
        activeFile.group === 'pr' ? (activeFile.modifiedRef ?? HEAD_REF) : HEAD_REF;
      void modelRegistry
        .registerModel(
          projectId,
          workspaceId,
          root,
          activeFile.path,
          language,
          'git',
          effectiveModifiedRef
        )
        .catch(() => {});
    }
    return () => {
      disposed = true;
      modelRegistry.unregisterModel(originalUri);
      modelRegistry.unregisterModel(modifiedUri);
      if (activeFile.group === 'disk') {
        modelRegistry.unregisterModel(modelRegistry.toDiskUri(uri));
      }
    };
  }, [isBinary, originalUri, modifiedUri, language, activeFile, projectId, workspaceId, root, uri]);

  if (!diffView) return null;

  return (
    <div className="file-diff-view flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        {showEditor && (
          <StickyDiffEditor
            originalUri={originalUri}
            modifiedUri={modifiedUri}
            diffStyle={diffView.diffStyle}
            onEditorChange={setEditor}
          />
        )}
        {!activeFile && (
          <EmptyState
            label="Select a file to view changes"
            description="Select a file to view changes"
          />
        )}
        {activeFile && isImage && (
          <ImageDiffView
            key={imageDiffKey}
            projectId={projectId}
            workspaceId={workspaceId}
            activeFile={activeFile}
          />
        )}
        {isBinary && !isImage && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Binary file — no diff available
          </div>
        )}
      </div>
    </div>
  );
});
