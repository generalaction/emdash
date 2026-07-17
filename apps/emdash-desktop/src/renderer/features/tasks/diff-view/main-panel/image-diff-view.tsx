import type { ActiveFile } from '@core/features/tasks/contributions/mementos';
import type { ImageReadResult, ImageUnavailableReason } from '@emdash/core/runtimes/git/api';
import { useQuery } from '@tanstack/react-query';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useWorkspace } from '@renderer/features/tasks/task-view-context';
import { readRuntimeImage } from '@renderer/lib/runtime/files';
import { checkoutSelector, gitFilePath } from '@renderer/lib/runtime/git';
import { getGitRuntimeClient } from '@renderer/lib/runtime/git-client';
import { formatBytes } from '@renderer/utils/formatBytes';
import { HEAD_REF, type GitRef } from '@shared/core/git/types';
import { gitRefToString } from '@shared/core/git/utils';

interface ImageDiffViewProps {
  projectId: string;
  workspaceId: string;
  activeFile: ActiveFile;
}

type SideState =
  | { status: 'loading' }
  | { status: 'ready'; dataUrl: string; mimeType: string; size: number }
  | { status: 'missing' }
  | { status: 'unavailable'; reason: ImageUnavailableReason }
  | { status: 'error'; message: string };

type Side = 'original' | 'modified';

function unavailableMessage(reason: ImageUnavailableReason): string {
  switch (reason) {
    case 'unsupported':
      return 'Preview unavailable for this format';
    case 'too-large':
      return 'Preview unavailable — file is too large';
    case 'lfs-pointer':
      return 'Preview unavailable — Git LFS smudge filter not applied';
    case 'git-error':
      return 'Preview unavailable';
  }
}

function fromImageReadResult(result: ImageReadResult): SideState {
  switch (result.kind) {
    case 'image':
      return {
        status: 'ready',
        dataUrl: result.image.dataUrl,
        mimeType: result.image.mimeType,
        size: result.image.size,
      };
    case 'missing':
      return { status: 'missing' };
    case 'unavailable':
      return { status: 'unavailable', reason: result.reason };
  }
}

async function loadGitImage(
  call: () => Promise<{ success: true; data: ImageReadResult } | { success: false }>
): Promise<SideState> {
  const res = await call();
  if (!res.success) return { status: 'error', message: 'Failed to load image' };
  return fromImageReadResult(res.data);
}

function loadFromRef(workspacePath: string, filePath: string, ref: GitRef): Promise<SideState> {
  return loadGitImage(async () => {
    const client = await getGitRuntimeClient();
    return client.checkout.getImageAtRef({
      ...checkoutSelector(workspacePath),
      filePath: gitFilePath(filePath),
      ref: gitRefToString(ref),
    });
  });
}

async function loadFromDisk(workspacePath: string, filePath: string): Promise<SideState> {
  const res = await readRuntimeImage(workspacePath, filePath);
  if (!res.success) {
    return res.error.type === 'not-found' || res.error.type === 'not-a-directory'
      ? { status: 'missing' }
      : { status: 'unavailable', reason: 'git-error' };
  }
  const image = res.data;
  if (image.truncated) return { status: 'unavailable', reason: 'too-large' };
  return {
    status: 'ready',
    dataUrl: image.dataUrl,
    mimeType: image.mimeType ?? 'application/octet-stream',
    size: image.size ?? 0,
  };
}

function loadOriginal(workspacePath: string, activeFile: ActiveFile): Promise<SideState> {
  const ref: GitRef = activeFile.group === 'staged' ? HEAD_REF : activeFile.originalRef;
  return loadFromRef(workspacePath, activeFile.path, ref);
}

function loadModified(workspacePath: string, activeFile: ActiveFile): Promise<SideState> {
  switch (activeFile.group) {
    case 'disk':
      return loadFromDisk(workspacePath, activeFile.path);
    case 'staged':
      return loadGitImage(async () => {
        const client = await getGitRuntimeClient();
        return client.checkout.getImageAtIndex({
          ...checkoutSelector(workspacePath),
          filePath: gitFilePath(activeFile.path),
        });
      });
    case 'git':
    case 'pr':
      return loadFromRef(workspacePath, activeFile.path, activeFile.modifiedRef ?? HEAD_REF);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryModifiedLoad(state: SideState): boolean {
  return (
    state.status === 'error' || (state.status === 'unavailable' && state.reason === 'git-error')
  );
}

async function loadModifiedWithTransientRetry(
  workspacePath: string,
  activeFile: ActiveFile
): Promise<SideState> {
  const delays = [120, 300, 600];
  let state = await loadModified(workspacePath, activeFile);

  for (const ms of delays) {
    if (!shouldRetryModifiedLoad(state)) return state;
    await delay(ms);
    state = await loadModified(workspacePath, activeFile);
  }

  return state;
}

function ImageSidePanel({ label, state, side }: { label: string; state: SideState; side: Side }) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-baseline gap-2 border-b border-border px-3 py-2">
        <span className="font-sans text-xs text-foreground-muted">{label}</span>
        {state.status === 'ready' && (
          <span className="font-sans text-[10px] text-foreground-passive">
            {formatBytes(state.size)}
          </span>
        )}
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-4">
        <ImageSideContent state={state} side={side} />
      </div>
    </div>
  );
}

function ImageSideContent({ state, side }: { state: SideState; side: Side }) {
  switch (state.status) {
    case 'loading':
      return <div className="text-xs text-foreground-passive">Loading…</div>;
    case 'missing':
      return (
        <div className="text-xs text-foreground-passive">
          {side === 'original' ? 'File added' : 'File deleted'}
        </div>
      );
    case 'unavailable':
      return (
        <div className="text-xs text-foreground-passive">{unavailableMessage(state.reason)}</div>
      );
    case 'error':
      return <div className="text-xs text-foreground-passive">{state.message}</div>;
    case 'ready':
      return <PreviewImage state={state} alt={side} />;
  }
}

function PreviewImage({
  state,
  alt,
}: {
  state: Extract<SideState, { status: 'ready' }>;
  alt: string;
}) {
  const [decodeFailed, setDecodeFailed] = useState(false);

  if (decodeFailed) {
    return <div className="text-xs text-foreground-passive">Failed to decode image</div>;
  }

  return (
    <img
      key={state.dataUrl}
      src={state.dataUrl}
      alt={alt}
      className="max-h-full max-w-full object-contain"
      onError={() => setDecodeFailed(true)}
    />
  );
}

export const ImageDiffView = observer(function ImageDiffView({
  projectId,
  workspaceId,
  activeFile,
}: ImageDiffViewProps) {
  const workspace = useWorkspace();
  const git = workspace.gitCheckout;

  const fileKey = `${activeFile.path}|${activeFile.group}|${gitRefToString(activeFile.originalRef)}|${activeFile.modifiedRef ? gitRefToString(activeFile.modifiedRef) : ''}`;

  // For disk/staged groups the bytes can change without fileKey changing
  // (in-place overwrite, re-stage). Pinning to statusRevision reruns the
  // load whenever GitCheckoutStore observes an fs-watch or index event.
  const reactiveRevision =
    activeFile.group === 'disk' || activeFile.group === 'staged' ? git.statusRevision : 0;

  const placeholder: SideState = { status: 'loading' };

  const originalQuery = useQuery({
    queryKey: ['image-diff', 'original', projectId, workspaceId, fileKey, reactiveRevision],
    queryFn: () => loadOriginal(workspace.path, activeFile),
    placeholderData: placeholder,
    staleTime: Infinity,
  });

  const modifiedQuery = useQuery({
    queryKey: ['image-diff', 'modified', projectId, workspaceId, fileKey, reactiveRevision],
    queryFn: () => loadModifiedWithTransientRetry(workspace.path, activeFile),
    placeholderData: placeholder,
    staleTime: Infinity,
  });

  const original = originalQuery.data ?? placeholder;
  const modified = modifiedQuery.data ?? placeholder;

  return (
    <div className="flex h-full min-h-0 w-full">
      <ImageSidePanel label="Original" state={original} side="original" />
      <div className="w-px shrink-0 bg-border" />
      <ImageSidePanel label="Modified" state={modified} side="modified" />
    </div>
  );
});
