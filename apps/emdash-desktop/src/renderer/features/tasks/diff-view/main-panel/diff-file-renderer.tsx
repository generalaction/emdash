import { observer } from 'mobx-react-lite';
import type * as monaco from 'monaco-editor';
import { useCallback, useEffect, useState } from 'react';
import { useDiffEditorComments } from '@renderer/features/tasks/diff-view/comments/use-diff-editor-comments';
import { ImageDiffView } from '@renderer/features/tasks/diff-view/main-panel/image-diff-view';
import { isMissingFileError } from '@renderer/features/tasks/diff-view/main-panel/missing-file-error';
import { getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import type { DiffTabStore } from '@renderer/features/tasks/tabs/diff-tab-store';
import {
  useTaskViewContext,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { getFileKind } from '@renderer/lib/editor/fileKind';
import { PreviewSourceToggle } from '@renderer/lib/editor/preview-source-toggle';
import { useDelayedBoolean } from '@renderer/lib/hooks/use-delay-boolean';
import { rpc } from '@renderer/lib/ipc';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { StickyDiffEditor } from '@renderer/lib/monaco/sticky-diff-editor';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { ShowHide } from '@renderer/lib/ui/show-hide';
import { Spinner } from '@renderer/lib/ui/spinner';
import { getLanguageFromPath } from '@renderer/utils/languageUtils';
import {
  gitRefToString,
  HEAD_REF,
  STAGED_REF,
  type GitObjectRef,
  type GitRef,
} from '@shared/core/git/git';
import { getDraftCommentTargetKey, type DraftCommentTarget } from '@shared/lineComments';
import type { ActiveFile } from '@shared/view-state';

interface DiffFileRendererProps {
  tab: DiffTabStore;
}

/**
 * Routes a diff tab to the correct renderer based on its renderer kind.
 * Mirrors the FileRenderer pattern for file tabs.
 */
export const DiffFileRenderer = observer(function DiffFileRenderer({ tab }: DiffFileRendererProps) {
  const { projectId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();

  switch (tab.renderer.kind) {
    case 'text': {
      // Markdown files get a rendered-preview toggle (Eye) alongside the source
      // diff (Pencil), mirroring the file-tab markdown renderer. Deleted files
      // have no "after" content to render, so they stay diff-only.
      if (getFileKind(tab.path) === 'markdown' && tab.status !== 'deleted') {
        return <MarkdownDiffRenderer tab={tab} />;
      }
      return <MonacoDiffRenderer tab={tab} />;
    }
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

/**
 * Renders a text diff using the Monaco diff editor.
 * Owns model registration, URI computation, and draft comment wiring.
 */
const MonacoDiffRenderer = observer(function MonacoDiffRenderer({ tab }: DiffFileRendererProps) {
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

  const language = getLanguageFromPath(tab.path);
  const { root, uri, originalUri, modifiedUri } = computeDiffUris(tab, workspaceId);

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

/**
 * Computes the original/modified Monaco model URIs for a diff tab. Shared by the
 * Monaco diff editor and the markdown preview so both read identical content.
 */
function computeDiffUris(
  tab: DiffTabStore,
  workspaceId: string
): { root: string; uri: string; originalUri: string; modifiedUri: string } {
  const root = `workspace:${workspaceId}`;
  const uri = buildMonacoModelPath(root, tab.path);

  const originalUri = (() => {
    if (tab.diffGroup === 'disk') return modelRegistry.toGitUri(uri, STAGED_REF);
    if (tab.diffGroup === 'git' || tab.diffGroup === 'pr') {
      return modelRegistry.toGitUri(uri, tab.originalRef);
    }
    return modelRegistry.toGitUri(uri, HEAD_REF);
  })();

  const modifiedUri = (() => {
    if (tab.diffGroup === 'staged') return modelRegistry.toGitUri(uri, STAGED_REF);
    if (tab.diffGroup === 'pr') return modelRegistry.toGitUri(uri, tab.modifiedRef ?? HEAD_REF);
    if (tab.diffGroup === 'git') return modelRegistry.toGitUri(uri, tab.modifiedRef ?? HEAD_REF);
    return uri;
  })();

  return { root, uri, originalUri, modifiedUri };
}

/**
 * Renders a markdown diff tab with a toggle between the source diff (Pencil) and
 * a rendered markdown preview (Eye), mirroring the file-tab MarkdownEditorRenderer.
 *
 * The Monaco diff editor is kept mounted via ShowHide while the preview is shown,
 * so its models stay registered and the preview can read their content.
 */
const MarkdownDiffRenderer = observer(function MarkdownDiffRenderer({
  tab,
}: DiffFileRendererProps) {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <ShowHide visible={!tab.showRendered}>
        <MonacoDiffRenderer tab={tab} />
      </ShowHide>
      {tab.showRendered && <MarkdownDiffPreview tab={tab} />}
      <PreviewSourceToggle
        activeMode={tab.showRendered ? 'preview' : 'source'}
        onSwitch={(mode) => tab.setShowRendered(mode === 'preview')}
        sourceLabel="View diff"
      />
    </div>
  );
});

/** Where a rendered side's linked images come from, matching its diff source. */
type ImageSource = { kind: 'disk' } | { kind: 'index' } | { kind: 'ref'; ref: GitRef };

/**
 * Resolves which source a rendered side's images come from, mirroring the
 * original/modified ref selection in computeDiffUris so images stay consistent
 * with the text being shown: working tree, index, or a specific git ref.
 */
function imageSourceForSide(tab: DiffTabStore, side: 'original' | 'modified'): ImageSource {
  if (side === 'original') {
    if (tab.diffGroup === 'disk') return { kind: 'index' };
    if (tab.diffGroup === 'git' || tab.diffGroup === 'pr') {
      return { kind: 'ref', ref: tab.originalRef };
    }
    return { kind: 'ref', ref: HEAD_REF };
  }
  if (tab.diffGroup === 'staged') return { kind: 'index' };
  if (tab.diffGroup === 'git' || tab.diffGroup === 'pr') {
    return { kind: 'ref', ref: tab.modifiedRef ?? HEAD_REF };
  }
  return { kind: 'disk' };
}

/** Resolves a relative markdown image against the correct side/source of the diff. */
async function resolveSideImage(
  tab: DiffTabStore,
  side: 'original' | 'modified',
  projectId: string,
  workspaceId: string,
  fileDir: string,
  src: string
): Promise<string | null> {
  const imagePath = fileDir ? `${fileDir}/${src}` : src;
  const source = imageSourceForSide(tab, side);
  if (source.kind === 'disk') {
    const res = await rpc.workspace.fs.readImage(projectId, workspaceId, imagePath);
    return res.success ? (res.data?.dataUrl ?? null) : null;
  }
  const res =
    source.kind === 'index'
      ? await rpc.workspace.git.getImageAtIndex(projectId, workspaceId, imagePath)
      : await rpc.workspace.git.getImageAtRef(
          projectId,
          workspaceId,
          imagePath,
          gitRefToString(source.ref)
        );
  if (!res.success) return null;
  return res.data.result.kind === 'image' ? res.data.result.image.dataUrl : null;
}

/**
 * Renders the modified ("after") markdown content as a formatted preview. In
 * split mode it shows the original (left) and modified (right) side by side,
 * reusing the diff toolbar's unified/split toggle for consistency.
 *
 * Content is read from the Monaco diff models and kept in sync via
 * onDidChangeContent, so the preview tracks model refreshes (e.g. index/disk
 * reloads) instead of going stale. Linked images are resolved from the same
 * source as the side being rendered.
 */
const MarkdownDiffPreview = observer(function MarkdownDiffPreview({ tab }: DiffFileRendererProps) {
  const { projectId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const diffStyle = useWorkspaceViewModel().diffView?.diffStyle ?? 'unified';
  const { originalUri, modifiedUri } = computeDiffUris(tab, workspaceId);

  // Model load status drives the loading spinner and triggers the content
  // listeners below to (re)attach once a model becomes available.
  const originalStatus = modelRegistry.modelStatus.get(originalUri);
  const modifiedStatus = modelRegistry.modelStatus.get(modifiedUri);

  const [newContent, setNewContent] = useState('');
  const [oldContent, setOldContent] = useState('');

  // Read content imperatively and keep it in sync via onDidChangeContent rather
  // than the file-tab markdown renderer's bufferVersions MobX dependency: the
  // registry only bumps bufferVersions for the editable buffer model, never for
  // git/index models, so a bufferVersions dependency would go stale when a
  // staged/ref/PR diff reloads. onDidChangeContent also fires for those in-place
  // setValue() refreshes, so it covers every side.
  useEffect(() => {
    const model = modelRegistry.getModelByUri(modifiedUri);
    if (!model) {
      setNewContent('');
      return;
    }
    setNewContent(model.getValue());
    const sub = model.onDidChangeContent(() => setNewContent(model.getValue()));
    return () => sub.dispose();
  }, [modifiedUri, modifiedStatus]);

  useEffect(() => {
    const model = modelRegistry.getModelByUri(originalUri);
    if (!model) {
      setOldContent('');
      return;
    }
    setOldContent(model.getValue());
    const sub = model.onDidChangeContent(() => setOldContent(model.getValue()));
    return () => sub.dispose();
  }, [originalUri, originalStatus]);

  const fileDir = tab.path.includes('/') ? tab.path.substring(0, tab.path.lastIndexOf('/')) : '';
  const resolveModifiedImage = useCallback(
    (src: string) => resolveSideImage(tab, 'modified', projectId, workspaceId, fileDir, src),
    [tab, projectId, workspaceId, fileDir]
  );
  const resolveOriginalImage = useCallback(
    (src: string) => resolveSideImage(tab, 'original', projectId, workspaceId, fileDir, src),
    [tab, projectId, workspaceId, fileDir]
  );

  const modifiedLoading = !modifiedStatus || modifiedStatus === 'loading';
  const originalLoading = !originalStatus || originalStatus === 'loading';
  const waiting = diffStyle === 'split' ? modifiedLoading || originalLoading : modifiedLoading;
  const showSpinner = useDelayedBoolean(waiting, 200);

  if (showSpinner) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background-secondary-1">
        <Spinner />
      </div>
    );
  }

  if (diffStyle === 'split') {
    return (
      <div className="flex h-full w-full">
        <div className="h-full flex-1 overflow-y-auto border-r border-border bg-background-secondary-1">
          <MarkdownRenderer
            content={oldContent}
            variant="full"
            className="w-full max-w-3xl px-8 py-8"
            resolveImage={resolveOriginalImage}
          />
        </div>
        <div className="h-full flex-1 overflow-y-auto bg-background-secondary-1">
          <MarkdownRenderer
            content={newContent}
            variant="full"
            className="w-full max-w-3xl px-8 py-8"
            resolveImage={resolveModifiedImage}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-background-secondary-1">
      <MarkdownRenderer
        content={newContent}
        variant="full"
        className="w-full max-w-3xl px-8 py-8"
        resolveImage={resolveModifiedImage}
      />
    </div>
  );
});

function refShaOrString(ref: GitObjectRef | undefined): string {
  if (!ref) return gitRefToString(HEAD_REF);
  return ref.kind === 'commit' ? ref.sha : gitRefToString(ref);
}

function diffTabToCommentTarget(tab: DiffTabStore): DraftCommentTarget {
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

function tabToActiveFile(tab: DiffTabStore): ActiveFile {
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
