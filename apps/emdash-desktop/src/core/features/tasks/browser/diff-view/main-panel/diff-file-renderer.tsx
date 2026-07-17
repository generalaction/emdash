import type { GitObjectRef } from '@emdash/core/runtimes/git/api';
import { observer } from 'mobx-react-lite';
import type * as monaco from 'monaco-editor';
import { useCallback, useEffect, useState } from 'react';
import { useDiffEditorComments } from '@core/features/tasks/browser/diff-view/comments/use-diff-editor-comments';
import { ImageDiffView } from '@core/features/tasks/browser/diff-view/main-panel/image-diff-view';
import { isMissingFileError } from '@core/features/tasks/browser/diff-view/main-panel/missing-file-error';
import type { DiffTabResource } from '@core/features/tasks/browser/diff-view/stores/diff-tab-resource';
import { getTaskStore } from '@core/features/tasks/browser/stores/task-selectors';
import {
  useTaskViewContext,
  useWorkspace,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@core/features/tasks/browser/task-view-context';
import type { ActiveFile } from '@core/features/tasks/contributions/mementos';
import { usePaneContext } from '@core/features/workbench/browser/tabs/pane-context';
import { HEAD_REF, STAGED_REF } from '@core/primitives/git/api';
import { gitRefToString } from '@core/primitives/git/api';
import {
  getDraftCommentTargetKey,
  type DraftCommentTarget,
} from '@core/primitives/line-comments/api';
import { HtmlContentRenderer } from '@renderer/lib/editor/html-renderer';
import { resolveWorkspaceResourcePath } from '@renderer/lib/editor/workspace-resource-path';
import { ModelStatusOverlay } from '@renderer/lib/monaco/model-status-overlay';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { StickyDiffEditor } from '@renderer/lib/monaco/sticky-diff-editor';
import { useModelStatus } from '@renderer/lib/monaco/use-model';
import { readRuntimeImage } from '@renderer/lib/runtime/files';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { getLanguageFromPath } from '@renderer/utils/languageUtils';

interface DiffFileRendererProps {
  tab: DiffTabResource;
}

/**
 * Routes a diff tab to the correct renderer based on its renderer kind.
 * Mirrors the FileRenderer pattern for file tabs.
 */
export const DiffFileRenderer = observer(function DiffFileRenderer({ tab }: DiffFileRendererProps) {
  const { projectId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();

  switch (tab.renderer.kind) {
    case 'text':
      return <TextDiffRenderer tab={tab} />;
    case 'image': {
      const activeFile = tabToActiveFile(tab);
      return (
        <ImageDiffView
          key={`${workspaceId}:${tab.diffGroup}:${tab.path}`}
          projectId={projectId}
          workspaceId={workspaceId}
          activeFile={activeFile}
        />
      );
    }
    case 'binary':
      return (
        <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
          Binary file — no diff available
        </div>
      );
  }
});

/** Owns text diff model registration, preview rendering, and draft comment wiring. */
const TextDiffRenderer = observer(function TextDiffRenderer({ tab }: DiffFileRendererProps) {
  const { projectId, taskId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const diffView = useWorkspaceViewModel().diffView;
  const draftComments = getTaskStore(projectId, taskId)?.draftComments;

  const [editor, setEditor] = useState<monaco.editor.IStandaloneDiffEditor | null>(null);

  const commentTarget = diffTabToCommentTarget(tab);
  const commentTargetKey = getDraftCommentTargetKey(commentTarget);
  const comments = draftComments?.getCommentsForTarget(commentTargetKey) ?? [];

  const handleAddComment = useCallback(
    (lineNumber: number, content: string, lineContent?: string) => {
      if (!draftComments) return;
      draftComments.addComment({
        target: commentTarget,
        lineNumber,
        lineContent: lineContent ?? null,
        content,
      });
    },
    [commentTarget, draftComments]
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
    editor,
    comments,
    onAddComment: handleAddComment,
    onEditComment: handleEditComment,
    onDeleteComment: handleDeleteComment,
  });

  const root = `workspace:${workspaceId}`;
  const uri = buildMonacoModelPath(root, tab.path);
  const language = getLanguageFromPath(tab.path);

  const originalUri = (() => {
    if (tab.diffGroup === 'disk') {
      return modelRegistry.toGitUri(uri, STAGED_REF);
    }
    if (tab.diffGroup === 'git' || tab.diffGroup === 'pr') {
      return modelRegistry.toGitUri(uri, tab.originalRef);
    }
    return modelRegistry.toGitUri(uri, HEAD_REF);
  })();

  const modifiedUri = (() => {
    if (tab.diffGroup === 'staged') return modelRegistry.toGitUri(uri, STAGED_REF);
    if (tab.diffGroup === 'pr') {
      return modelRegistry.toGitUri(uri, tab.modifiedRef ?? HEAD_REF);
    }
    if (tab.diffGroup === 'git') {
      return modelRegistry.toGitUri(uri, tab.modifiedRef ?? HEAD_REF);
    }
    return uri;
  })();

  const previewContentUri = modifiedUri;

  useEffect(() => {
    let disposed = false;

    if (tab.diffGroup === 'disk') {
      const diskUri = modelRegistry.toDiskUri(uri);
      void (async () => {
        if (tab.status !== 'deleted') {
          try {
            await modelRegistry.registerModel(
              projectId,
              workspaceId,
              root,
              tab.path,
              language,
              'disk'
            );
          } catch (err) {
            if (!isMissingFileError(err)) throw err;
          }
        }
        if (disposed) {
          modelRegistry.unregisterModel(diskUri);
          return;
        }
        await modelRegistry.registerModel(
          projectId,
          workspaceId,
          root,
          tab.path,
          language,
          'buffer'
        );
        if (disposed) {
          modelRegistry.unregisterModel(modifiedUri);
        }
      })().catch(() => {});
      void modelRegistry
        .registerModel(projectId, workspaceId, root, tab.path, language, 'git', STAGED_REF)
        .catch(() => {});
    } else if (tab.diffGroup === 'staged') {
      void modelRegistry
        .registerModel(projectId, workspaceId, root, tab.path, language, 'git', HEAD_REF)
        .catch(() => {});
      void modelRegistry
        .registerModel(projectId, workspaceId, root, tab.path, language, 'git', STAGED_REF)
        .catch(() => {});
    } else {
      void modelRegistry
        .registerModel(projectId, workspaceId, root, tab.path, language, 'git', tab.originalRef)
        .catch(() => {});
      const effectiveModifiedRef = tab.modifiedRef ?? HEAD_REF;
      void modelRegistry
        .registerModel(
          projectId,
          workspaceId,
          root,
          tab.path,
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
      if (tab.diffGroup === 'disk') {
        modelRegistry.unregisterModel(modelRegistry.toDiskUri(uri));
      }
    };
  }, [
    originalUri,
    modifiedUri,
    language,
    tab.path,
    tab.diffGroup,
    tab.originalRef,
    tab.modifiedRef,
    tab.status,
    projectId,
    workspaceId,
    root,
    uri,
  ]);

  if (!diffView) return null;

  if (tab.viewMode === 'preview' && tab.renderer.kind === 'text' && tab.renderer.previewKind) {
    return (
      <DiffContentPreview
        tab={tab}
        contentUri={previewContentUri}
        previewKind={tab.renderer.previewKind}
      />
    );
  }

  return (
    <div className="file-diff-view flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        <StickyDiffEditor
          originalUri={originalUri}
          modifiedUri={modifiedUri}
          diffStyle={diffView.diffStyle}
          onEditorChange={setEditor}
        />
      </div>
    </div>
  );
});

interface DiffContentPreviewProps {
  tab: DiffTabResource;
  contentUri: string;
  previewKind: 'markdown' | 'html';
}

const DiffContentPreview = observer(function DiffContentPreview({
  tab,
  contentUri,
  previewKind,
}: DiffContentPreviewProps) {
  const workspacePath = useWorkspace().path;
  const { pane } = usePaneContext();
  const status = useModelStatus(contentUri);
  void modelRegistry.bufferVersions.get(contentUri);

  if (tab.status === 'deleted') {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Deleted file — no preview available
      </div>
    );
  }

  if (status !== 'ready') {
    return (
      <div className="relative h-full bg-background-secondary-1">
        <ModelStatusOverlay status={status} />
      </div>
    );
  }

  const content = modelRegistry.getModelByUri(contentUri)?.getValue() ?? '';

  if (previewKind === 'html') {
    return <HtmlContentRenderer filePath={tab.path} rawContent={content} />;
  }

  const resolveImage = async (src: string): Promise<string | null> => {
    const imagePath = resolveWorkspaceResourcePath({
      workspacePath,
      containingFilePath: tab.path,
      resourcePath: src,
    });
    if (!imagePath) return null;
    const result = await readRuntimeImage(workspacePath, imagePath);
    return result.success && !result.data.truncated ? result.data.dataUrl : null;
  };

  const openWorkspaceLink = (href: string): boolean => {
    const target = resolveWorkspaceResourcePath({
      workspacePath,
      containingFilePath: tab.path,
      resourcePath: href,
    });
    if (!target) return false;
    pane.open('file', { path: target }, { preview: false });
    return true;
  };

  return (
    <div className="relative h-full overflow-y-auto bg-background-secondary-1">
      <MarkdownRenderer
        content={content}
        variant="full"
        className="w-full max-w-3xl px-8 py-8"
        resolveImage={resolveImage}
        onOpenLink={openWorkspaceLink}
      />
    </div>
  );
});

function refShaOrString(ref: GitObjectRef | undefined): string {
  if (!ref) return gitRefToString(HEAD_REF);
  return ref.kind === 'commit' ? ref.sha : gitRefToString(ref);
}

function diffTabToCommentTarget(tab: DiffTabResource): DraftCommentTarget {
  if (tab.diffGroup === 'disk' || tab.diffGroup === 'staged') {
    return { kind: 'working-tree', group: tab.diffGroup, path: tab.path };
  }

  if (tab.diffGroup === 'pr') {
    return {
      kind: 'pr',
      prNumber: tab.prNumber ?? 0,
      baseOid: tab.prBaseOid ?? refShaOrString(tab.originalRef),
      headOid: tab.prHeadOid ?? refShaOrString(tab.modifiedRef),
      path: tab.path,
    };
  }

  return {
    kind: 'commit',
    originalSha:
      tab.commitOriginalSha !== undefined ? tab.commitOriginalSha : refShaOrString(tab.originalRef),
    modifiedSha: tab.commitModifiedSha ?? refShaOrString(tab.modifiedRef),
    path: tab.path,
  };
}

function tabToActiveFile(tab: DiffTabResource): ActiveFile {
  return {
    path: tab.path,
    type: tab.diffGroup === 'disk' ? 'disk' : 'git',
    group: tab.diffGroup,
    originalRef: tab.originalRef,
    modifiedRef: tab.modifiedRef,
    prNumber: tab.prNumber,
    prBaseOid: tab.prBaseOid,
    prHeadOid: tab.prHeadOid,
    commitOriginalSha: tab.commitOriginalSha,
    commitModifiedSha: tab.commitModifiedSha,
  };
}
