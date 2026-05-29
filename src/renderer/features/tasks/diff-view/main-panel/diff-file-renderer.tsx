import { useQuery } from '@tanstack/react-query';
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
  useWorkspace,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { StickyDiffEditor } from '@renderer/lib/monaco/sticky-diff-editor';
import { formatBytes } from '@renderer/utils/formatBytes';
import { getLanguageFromPath } from '@renderer/utils/languageUtils';
import {
  gitRefToString,
  HEAD_REF,
  STAGED_REF,
  type GitRef,
  type ImageUnavailableReason,
  type PdfReadResult,
} from '@shared/git';
import type { Result } from '@shared/result';
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
    case 'text':
      return <MonacoDiffRenderer tab={tab} />;
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
    case 'pdf': {
      const activeFile = tabToActiveFile(tab);
      return (
        <PdfDiffView projectId={projectId} workspaceId={workspaceId} activeFile={activeFile} />
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

  const filePath = tab.path;
  const comments = draftComments?.getCommentsForFile(filePath) ?? [];

  const handleAddComment = useCallback(
    (lineNumber: number, content: string, lineContent?: string) => {
      if (!draftComments) return;
      draftComments.addComment({
        filePath,
        lineNumber,
        lineContent: lineContent ?? null,
        content,
      });
    },
    [filePath, draftComments]
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
      return modelRegistry.toGitUri(uri, HEAD_REF);
    }
    return uri;
  })();

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
      const effectiveModifiedRef =
        tab.diffGroup === 'pr' ? (tab.modifiedRef ?? HEAD_REF) : HEAD_REF;
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

function tabToActiveFile(tab: DiffTabStore): ActiveFile {
  return {
    path: tab.path,
    type: tab.diffGroup === 'disk' ? 'disk' : 'git',
    group: tab.diffGroup,
    originalRef: tab.originalRef,
    modifiedRef: tab.modifiedRef,
    prNumber: tab.prNumber,
  };
}

type PdfSideState =
  | { status: 'loading' }
  | { status: 'ready'; dataUrl: string; size: number }
  | { status: 'missing' }
  | { status: 'unavailable'; reason: ImageUnavailableReason }
  | { status: 'error'; message: string };

type PdfRpcResult = Result<{ result: PdfReadResult }, unknown>;

function fromPdfReadResult(result: PdfReadResult): PdfSideState {
  switch (result.kind) {
    case 'pdf':
      return {
        status: 'ready',
        dataUrl: result.pdf.dataUrl,
        size: result.pdf.size,
      };
    case 'missing':
      return { status: 'missing' };
    case 'unavailable':
      return { status: 'unavailable', reason: result.reason };
  }
}

async function loadGitPdf(call: () => Promise<PdfRpcResult>): Promise<PdfSideState> {
  const res = await call();
  if (!res.success) return { status: 'error', message: 'Failed to load PDF' };
  return fromPdfReadResult(res.data.result);
}

function loadPdfFromRef(
  projectId: string,
  workspaceId: string,
  filePath: string,
  ref: GitRef
): Promise<PdfSideState> {
  return loadGitPdf(() =>
    rpc.git.getPdfAtRef(projectId, workspaceId, filePath, gitRefToString(ref))
  );
}

async function loadPdfFromDisk(
  projectId: string,
  workspaceId: string,
  filePath: string
): Promise<PdfSideState> {
  const res = await rpc.fs.readPdf(projectId, workspaceId, filePath);
  if (!res.success) return { status: 'unavailable', reason: 'git-error' };
  const pdf = res.data;
  if (!pdf?.success) {
    const error = pdf?.error ?? '';
    if (/not found/i.test(error)) return { status: 'missing' };
    return { status: 'unavailable', reason: 'git-error' };
  }
  const dataUrl = pdf.fileUrl ?? pdf.dataUrl;
  if (!dataUrl) return { status: 'unavailable', reason: 'git-error' };
  return { status: 'ready', dataUrl, size: pdf.size ?? 0 };
}

function loadPdfOriginal(
  projectId: string,
  workspaceId: string,
  activeFile: ActiveFile
): Promise<PdfSideState> {
  if (activeFile.group === 'disk') {
    return loadGitPdf(() => rpc.git.getPdfAtIndex(projectId, workspaceId, activeFile.path));
  }

  const ref: GitRef = activeFile.group === 'staged' ? HEAD_REF : activeFile.originalRef;
  return loadPdfFromRef(projectId, workspaceId, activeFile.path, ref);
}

function loadPdfModified(
  projectId: string,
  workspaceId: string,
  activeFile: ActiveFile
): Promise<PdfSideState> {
  switch (activeFile.group) {
    case 'disk':
      return loadPdfFromDisk(projectId, workspaceId, activeFile.path);
    case 'staged':
      return loadGitPdf(() => rpc.git.getPdfAtIndex(projectId, workspaceId, activeFile.path));
    case 'git':
    case 'pr':
      return loadPdfFromRef(
        projectId,
        workspaceId,
        activeFile.path,
        activeFile.modifiedRef ?? HEAD_REF
      );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryPdfModifiedLoad(state: PdfSideState): boolean {
  return (
    state.status === 'error' || (state.status === 'unavailable' && state.reason === 'git-error')
  );
}

async function loadPdfModifiedWithTransientRetry(
  projectId: string,
  workspaceId: string,
  activeFile: ActiveFile
): Promise<PdfSideState> {
  const delays = [120, 300, 600];
  let state = await loadPdfModified(projectId, workspaceId, activeFile);

  for (const ms of delays) {
    if (!shouldRetryPdfModifiedLoad(state)) return state;
    await delay(ms);
    state = await loadPdfModified(projectId, workspaceId, activeFile);
  }

  return state;
}

function pdfUnavailableMessage(reason: ImageUnavailableReason): string {
  switch (reason) {
    case 'ssh':
      return 'Preview unavailable on SSH workspaces';
    case 'unsupported':
      return 'Preview unavailable for this format';
    case 'too-large':
      return 'Preview unavailable — PDF is too large';
    case 'lfs-pointer':
      return 'Preview unavailable — Git LFS smudge filter not applied';
    case 'git-error':
      return 'Preview unavailable';
  }
}

function PdfSidePanel({
  label,
  state,
  side,
}: {
  label: string;
  state: PdfSideState;
  side: string;
}) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-baseline gap-2 border-b border-border px-3 py-2">
        <span className="font-mono text-xs tracking-wide text-foreground-muted uppercase">
          {label}
        </span>
        {state.status === 'ready' && (
          <span className="font-mono text-[10px] text-foreground-passive">
            {formatBytes(state.size)}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <PdfSideContent state={state} side={side} />
      </div>
    </div>
  );
}

function PdfSideContent({ state, side }: { state: PdfSideState; side: string }) {
  switch (state.status) {
    case 'loading':
      return (
        <div className="flex h-full items-center justify-center text-xs text-foreground-passive">
          Loading…
        </div>
      );
    case 'missing':
      return (
        <div className="flex h-full items-center justify-center text-xs text-foreground-passive">
          {side === 'original' ? 'File added' : 'File deleted'}
        </div>
      );
    case 'unavailable':
      return (
        <div className="flex h-full items-center justify-center text-xs text-foreground-passive">
          {pdfUnavailableMessage(state.reason)}
        </div>
      );
    case 'error':
      return (
        <div className="flex h-full items-center justify-center text-xs text-foreground-passive">
          {state.message}
        </div>
      );
    case 'ready':
      return (
        <object className="h-full w-full" data={state.dataUrl} title={side} type="application/pdf">
          <div className="flex h-full items-center justify-center text-xs text-foreground-passive">
            PDF preview unavailable
          </div>
        </object>
      );
  }
}

const PdfDiffView = observer(function PdfDiffView({
  projectId,
  workspaceId,
  activeFile,
}: {
  projectId: string;
  workspaceId: string;
  activeFile: ActiveFile;
}) {
  const workspace = useWorkspace();
  const fileKey = `${activeFile.path}|${activeFile.group}|${gitRefToString(activeFile.originalRef)}|${activeFile.modifiedRef ? gitRefToString(activeFile.modifiedRef) : ''}`;
  const reactiveRevision =
    activeFile.group === 'disk' || activeFile.group === 'staged'
      ? workspace.git.fullStatus.lastUpdatedAt
      : 0;
  const placeholder: PdfSideState = { status: 'loading' };
  const staleTime = activeFile.group === 'disk' ? 25_000 : Infinity;

  const originalQuery = useQuery({
    queryKey: ['pdf-diff', 'original', projectId, workspaceId, fileKey, reactiveRevision],
    queryFn: () => loadPdfOriginal(projectId, workspaceId, activeFile),
    placeholderData: placeholder,
    staleTime,
  });

  const modifiedQuery = useQuery({
    queryKey: ['pdf-diff', 'modified', projectId, workspaceId, fileKey, reactiveRevision],
    queryFn: () => loadPdfModifiedWithTransientRetry(projectId, workspaceId, activeFile),
    placeholderData: placeholder,
    staleTime,
  });

  const original = originalQuery.data ?? placeholder;
  const modified = modifiedQuery.data ?? placeholder;

  if (original.status === 'missing' && modified.status === 'ready') {
    return (
      <div className="flex h-full min-h-0 w-full">
        <PdfSidePanel label="Added" state={modified} side="modified" />
      </div>
    );
  }

  if (modified.status === 'missing' && original.status === 'ready') {
    return (
      <div className="flex h-full min-h-0 w-full">
        <PdfSidePanel label="Deleted" state={original} side="original" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full">
      <PdfSidePanel label="Original" state={original} side="original" />
      <div className="w-px shrink-0 bg-border" />
      <PdfSidePanel label="Modified" state={modified} side="modified" />
    </div>
  );
});
