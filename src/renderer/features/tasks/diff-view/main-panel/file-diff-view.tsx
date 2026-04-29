import { observer } from 'mobx-react-lite';
import type * as monaco from 'monaco-editor';
import { useCallback, useEffect, useState } from 'react';
import { HEAD_REF, STAGED_REF } from '@shared/git';
import { useDiffEditorComments } from '@renderer/features/tasks/diff-view/comments/use-diff-editor-comments';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { isBinaryForDiff, isImagePreviewableForDiff } from '@renderer/lib/editor/fileKind';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { StickyDiffEditor } from '@renderer/lib/monaco/sticky-diff-editor';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { getLanguageFromPath } from '@renderer/utils/languageUtils';
import { ImageDiffViewer } from './image-diff-viewer';

export const FileDiffView = observer(function FileDiffView() {
  const { projectId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const { workspaceId } = provisioned;
  const diffView = provisioned.taskView.diffView;
  const draftComments = provisioned.draftComments;
  const activeFile = diffView.activeFile;
  const [editor, setEditor] = useState<monaco.editor.IStandaloneDiffEditor | null>(null);

  const isImage = activeFile ? isImagePreviewableForDiff(activeFile.path) : false;
  const isBinary = activeFile ? isBinaryForDiff(activeFile.path) : false;
  const showEditor = activeFile !== null && !isBinary;
  const activeFilePath = activeFile?.path ?? '';

  const comments = activeFilePath ? draftComments.getCommentsForFile(activeFilePath) : [];

  const handleAddComment = useCallback(
    (lineNumber: number, content: string, lineContent?: string) => {
      if (!activeFilePath) return;
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
      draftComments.updateComment(id, content);
    },
    [draftComments]
  );

  const handleDeleteComment = useCallback(
    (id: string) => {
      draftComments.deleteComment(id);
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
    return modelRegistry.toDiskUri(uri);
  })();

  // Register/unregister models whenever the active file changes.
  useEffect(() => {
    if (!activeFile || isBinary) return;

    if (activeFile.group === 'disk') {
      void modelRegistry
        .registerModel(projectId, workspaceId, root, activeFile.path, language, 'disk')
        .catch(() => {});
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
      modelRegistry.unregisterModel(originalUri);
      modelRegistry.unregisterModel(modifiedUri);
    };
  }, [isBinary, originalUri, modifiedUri, language, activeFile, projectId, workspaceId, root]);

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
        {isBinary &&
          (isImage && activeFile ? (
            <ImageDiffViewer
              projectId={projectId}
              workspaceId={workspaceId}
              filePath={activeFile.path}
              diffType={activeFile.group}
              originalRef={activeFile.originalRef}
              modifiedRef={activeFile.modifiedRef}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Binary file — no diff available
            </div>
          ))}
      </div>
    </div>
  );
});
