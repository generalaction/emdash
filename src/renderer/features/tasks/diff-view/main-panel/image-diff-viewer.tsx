import { useEffect, useState } from 'react';
import { gitRefToString, HEAD_REF, type GitRef } from '@shared/git';
import type { Result } from '@shared/result';
import { rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';

type ImageDiffType = 'disk' | 'staged' | 'git' | 'pr';

type ImageSide = {
  label: string;
  dataUrl: string | null;
  error?: string;
};

interface ImageDiffViewerProps {
  projectId: string;
  workspaceId: string;
  filePath: string;
  diffType: ImageDiffType;
  originalRef: GitRef;
  className?: string;
}

export function ImageDiffViewer({
  projectId,
  workspaceId,
  filePath,
  diffType,
  originalRef,
  className,
}: ImageDiffViewerProps) {
  const [loading, setLoading] = useState(true);
  const [original, setOriginal] = useState<ImageSide>({
    label: 'Before',
    dataUrl: null,
  });
  const [modified, setModified] = useState<ImageSide>({
    label: 'After',
    dataUrl: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      let originalSide: ImageSide;
      let modifiedSide: ImageSide;
      try {
        [originalSide, modifiedSide] = await Promise.all([
          loadOriginalImage(projectId, workspaceId, filePath, diffType, originalRef),
          loadModifiedImage(projectId, workspaceId, filePath, diffType),
        ]);
      } catch {
        originalSide = { label: 'Before', dataUrl: null, error: 'Image unavailable' };
        modifiedSide = { label: 'After', dataUrl: null, error: 'Image unavailable' };
      }

      if (cancelled) return;
      setOriginal(originalSide);
      setModified(modifiedSide);
      setLoading(false);
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [projectId, workspaceId, filePath, diffType, originalRef]);

  if (loading) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center text-sm text-foreground-passive',
          className
        )}
      >
        Loading image diff...
      </div>
    );
  }

  return (
    <div
      className={cn(
        'grid h-full min-h-0 grid-cols-1 gap-2 overflow-auto p-2 md:grid-cols-2',
        className
      )}
    >
      <ImagePane side={original} />
      <ImagePane side={modified} />
    </div>
  );
}

function ImagePane({ side }: { side: ImageSide }) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-background">
      <div className="border-b border-border px-3 py-1.5 text-xs font-medium text-foreground-muted">
        {side.label}
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
        {side.dataUrl ? (
          <img
            src={side.dataUrl}
            alt={side.label}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="text-sm text-foreground-passive">
            {side.error ?? 'Image unavailable'}
          </span>
        )}
      </div>
    </div>
  );
}

async function loadOriginalImage(
  projectId: string,
  workspaceId: string,
  filePath: string,
  diffType: ImageDiffType,
  originalRef: GitRef
): Promise<ImageSide> {
  const ref = diffType === 'git' || diffType === 'pr' ? originalRef : HEAD_REF;
  const result = await rpc.git.getImageAtRef(projectId, workspaceId, filePath, gitRefToString(ref));

  return imageSideFromResult('Before', result, 'No previous image');
}

async function loadModifiedImage(
  projectId: string,
  workspaceId: string,
  filePath: string,
  diffType: ImageDiffType
): Promise<ImageSide> {
  if (diffType === 'staged') {
    const result = await rpc.git.getImageAtIndex(projectId, workspaceId, filePath);
    return imageSideFromResult('After', result, 'No staged image');
  }

  if (diffType === 'git' || diffType === 'pr') {
    const result = await rpc.git.getImageAtRef(projectId, workspaceId, filePath, 'HEAD');
    return imageSideFromResult('After', result, 'No current image');
  }

  const result = await rpc.fs.readImage(projectId, workspaceId, filePath);
  return imageSideFromResult('After', result, 'No working tree image');
}

function imageSideFromResult(
  label: ImageSide['label'],
  result: Result<{ success: boolean; dataUrl?: string; error?: string }, unknown>,
  fallbackError: string
): ImageSide {
  if (!result.success) return { label, dataUrl: null, error: fallbackError };
  if (!result.data.success) {
    return { label, dataUrl: null, error: result.data.error ?? fallbackError };
  }
  return { label, dataUrl: result.data.dataUrl ?? null, error: result.data.error };
}
