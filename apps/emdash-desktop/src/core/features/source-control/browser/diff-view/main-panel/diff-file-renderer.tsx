import type { GitObjectRef } from '@emdash/core/runtimes/git/api';
import { Markdown } from '@emdash/ui/react/components';
import { Spinner } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import type * as monaco from 'monaco-editor';
import { useCallback, useEffect, useState } from 'react';
import type { ContentStatus } from '@core/features/editor/api/browser/open-file-store/open-file-store';
import { resolveWorkspaceResourcePath } from '@core/features/editor/api/browser/renderers/workspace-resource-path';
import {
  StickyDiffEditor,
  type DiffSideModel,
} from '@core/features/editor/contributions/browser/monaco/sticky-diff-editor';
import { HtmlContentRenderer } from '@core/features/editor/contributions/browser/renderers/html-renderer';
import { readImageFile } from '@core/features/files/api/browser/file-content';
import { draftCommentsStoreToken } from '@core/features/source-control/contributions/browser/task-stores';
import { getTaskStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import type { ActiveFile } from '@core/features/tasks/contributions/mementos';
import { resolveWorkspacePath } from '@core/features/workspaces/api/browser/workspace-path';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import { useMarkdownLinkOpener } from '@core/primitives/external-links/browser';
import { HEAD_REF } from '@core/primitives/git/api';
import { gitRefToString } from '@core/primitives/git/api';
import {
  getDraftCommentTargetKey,
  type DraftCommentTarget,
} from '@core/primitives/line-comments/api';
import { usePaneContext } from '@core/primitives/workbench-shell/browser/tabs/pane-context';
import { MonacoCommentManager } from '../comments/monaco-comment-manager';
import type { DiffTabResource } from '../stores/diff-tab-resource';
import { ImageDiffView } from './image-diff-view';
import { useDiffFacets } from './use-diff-facets';

interface DiffFileRendererProps {
  tab: DiffTabResource;
}

/**
 * Routes a diff tab to the correct renderer based on its renderer kind.
 * Mirrors the FileRenderer pattern for file tabs.
 */
export const DiffFileRenderer = observer(function DiffFileRenderer({ tab }: DiffFileRendererProps) {
  if (tab.unavailable) {
    return (
      <div
        role="status"
        className="flex h-full items-center justify-center text-sm text-foreground-muted"
      >
        This worktree is no longer available.
      </div>
    );
  }
  if (!tab.workspace) {
    return (
      <div
        role="status"
        className="flex h-full items-center justify-center text-sm text-foreground-muted"
      >
        Loading worktree…
      </div>
    );
  }
  const workspaceId = tab.workspaceId;

  switch (tab.renderer.kind) {
    case 'text':
      return <TextDiffRenderer tab={tab} />;
    case 'image': {
      const activeFile = tabToActiveFile(tab);
      return (
        <ImageDiffView
          key={`${workspaceId}:${tab.diffGroup}:${tab.path}`}
          projectId={tab.diffView?.projectId ?? ''}
          workspaceId={workspaceId}
          workspace={tab.workspace}
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

/** Owns text diff facet leases, preview rendering, and draft comment wiring. */
const TextDiffRenderer = observer(function TextDiffRenderer({ tab }: DiffFileRendererProps) {
  const workspace = tab.workspace;
  const diffView = tab.diffView;
  const draftComments = tab.readOnly
    ? undefined
    : diffView
      ? getTaskStore(diffView.projectId, diffView.taskId)?.get(draftCommentsStoreToken)
      : undefined;

  const bindComments = useCallback(
    (editor: monaco.editor.IStandaloneDiffEditor | null) => {
      if (!editor || !draftComments) return;
      const manager = new MonacoCommentManager(editor, {
        getComments: () =>
          draftComments.getCommentsForTarget(getDraftCommentTargetKey(diffTabToCommentTarget(tab))),
        onAddComment: (lineNumber, content, lineContent) => {
          draftComments.addComment({
            target: diffTabToCommentTarget(tab),
            lineNumber,
            lineContent: lineContent ?? null,
            content,
          });
        },
        onEditComment: (id, content) => {
          draftComments.updateComment(id, content);
        },
        onDeleteComment: (id) => {
          draftComments.deleteComment(id);
        },
      });
      return () => manager.dispose();
    },
    [draftComments, tab]
  );

  const sides = useDiffFacets({
    workspacePath: workspace?.path ?? '',
    sshConnectionId: workspace?.sshConnectionId,
    filePath: tab.path,
    group: tab.diffGroup,
    originalRef: tab.originalRef,
    modifiedRef: tab.modifiedRef,
  });

  if (!diffView || !workspace) return null;

  if (tab.viewMode === 'preview' && tab.renderer.kind === 'text' && tab.renderer.previewKind) {
    return (
      <DiffContentPreview tab={tab} side={sides.modified} previewKind={tab.renderer.previewKind} />
    );
  }

  return (
    <div className="file-diff-view flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        <StickyDiffEditor
          original={sides.original}
          modified={sides.modified}
          filePath={tab.path}
          diffStyle={diffView.diffStyle}
          readOnly={tab.readOnly}
          ref={bindComments}
        />
      </div>
    </div>
  );
});

interface DiffContentPreviewProps {
  tab: DiffTabResource;
  /** The diff's modified side — the content the preview renders. */
  side: DiffSideModel | null;
  previewKind: 'markdown' | 'html';
}

const DiffContentPreview = observer(function DiffContentPreview({
  tab,
  side,
  previewKind,
}: DiffContentPreviewProps) {
  const workspace = tab.workspace;
  const workspacePath = workspace?.path ?? '';
  const containingFilePath = resolveWorkspacePath(workspacePath, tab.path);
  const { pane } = usePaneContext();

  // The handle appears asynchronously on the observable entry; buffer edits
  // only fire the handle's change event, so bump a version to re-render.
  const handle = side?.kind === 'facet' ? side.entry.handleFor(side.facet) : undefined;
  const [, setContentVersion] = useState(0);
  useEffect(() => {
    if (!handle) return;
    return handle.onDidChange(() => setContentVersion((v) => v + 1));
  }, [handle]);

  const openWorkspaceLink = (href: string): boolean => {
    // Handle local links without opening an editable foreign file.
    const target = resolveWorkspaceResourcePath({
      workspacePath,
      containingFilePath,
      resourcePath: href,
    });
    if (!target) return false;
    if (tab.readOnly) return true;
    pane.open('file', { path: target }, { preview: false });
    return true;
  };
  const openLink = useMarkdownLinkOpener(openWorkspaceLink);

  if (tab.status === 'deleted') {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Deleted file — no preview available
      </div>
    );
  }

  const status = sideStatus(side);
  if (status.kind !== 'ready' || !handle) {
    return (
      <div className="relative h-full bg-(--em-surface)">
        <DiffPreviewStatusOverlay status={status} />
      </div>
    );
  }

  const content = handle.getText();

  if (previewKind === 'html') {
    return (
      <HtmlContentRenderer
        filePath={containingFilePath}
        rawContent={content}
        workspacePath={workspacePath}
        sshConnectionId={workspace?.sshConnectionId}
        readOnly={tab.readOnly}
      />
    );
  }

  const resolveImage = async (src: string): Promise<string | null> => {
    const imagePath = resolveWorkspaceResourcePath({
      workspacePath,
      containingFilePath,
      resourcePath: src,
    });
    if (!imagePath) return null;
    const result = await readImageFile(
      hostFileRefFromNativePath(imagePath, workspace?.sshConnectionId)
    );
    return result.success && !result.data.truncated ? result.data.dataUrl : null;
  };

  return (
    <div className="relative h-full overflow-y-auto bg-(--em-surface)">
      <Markdown
        content={content}
        variant="full"
        className="w-full max-w-3xl px-8 py-8"
        resolveImage={resolveImage}
        onOpenLink={openLink}
      />
    </div>
  );
});

/** Store status of the preview's side; loading until leases are held. */
function sideStatus(side: DiffSideModel | null): ContentStatus {
  if (!side || side.kind !== 'facet') return { kind: 'loading' };
  const status =
    side.facet.kind === 'git' ? side.entry.gitStatus(side.facet.ref) : side.entry.status;
  return status ?? { kind: 'loading' };
}

function DiffPreviewStatusOverlay({ status }: { status: ContentStatus }) {
  const message =
    status.kind === 'error'
      ? status.code === 'too-large'
        ? 'File too large to display in the editor'
        : 'Could not load file'
      : status.kind === 'orphaned'
        ? 'File was deleted on disk'
        : 'Loading file...';

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-(--em-surface) text-xs text-foreground-passive">
      <div className="flex items-center gap-2">
        {status.kind === 'loading' ? <Spinner size="sm" /> : null}
        <span>{message}</span>
      </div>
    </div>
  );
}

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
    workspaceId: tab.workspaceId,
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
