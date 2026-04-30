import { observer } from 'mobx-react-lite';
import { useCallback, useLayoutEffect, useRef } from 'react';
import { useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { Spinner } from '@renderer/lib/ui/spinner';
import { cn } from '@renderer/utils/utils';

interface MarkdownDiffPreviewProps {
  filePath: string;
  workspaceId: string;
  originalUri: string;
  modifiedUri: string;
  diffStyle: 'unified' | 'split';
  onHeightChange?: (height: number) => void;
}

export const MarkdownDiffPreview = observer(function MarkdownDiffPreview({
  filePath,
  workspaceId,
  originalUri,
  modifiedUri,
  diffStyle,
  onHeightChange,
}: MarkdownDiffPreviewProps) {
  const { projectId } = useTaskViewContext();
  const rootRef = useRef<HTMLDivElement>(null);
  const originalStatus = modelRegistry.modelStatus.get(originalUri);
  const modifiedStatus = modelRegistry.modelStatus.get(modifiedUri);

  // Subscribe to content invalidations before reading model values.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _originalVersion = modelRegistry.modelVersions.get(originalUri);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _modifiedVersion = modelRegistry.modelVersions.get(modifiedUri);

  const originalContent = modelRegistry.getModelByUri(originalUri)?.getValue() ?? '';
  const modifiedContent = modelRegistry.getModelByUri(modifiedUri)?.getValue() ?? '';
  const isLoading = originalStatus !== 'ready' || modifiedStatus !== 'ready';
  const hasError = originalStatus === 'error' || modifiedStatus === 'error';
  const fileDir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';

  const resolveImage = useCallback(
    async (src: string): Promise<string | null> => {
      const imagePath = fileDir ? `${fileDir}/${src}` : src;
      const result = await rpc.fs.readImage(projectId, workspaceId, imagePath);
      return result.success ? (result.data?.dataUrl ?? null) : null;
    },
    [projectId, workspaceId, fileDir]
  );

  useLayoutEffect(() => {
    if (!onHeightChange || !rootRef.current) return;
    const node = rootRef.current;
    const updateHeight = () => onHeightChange(node.scrollHeight);
    updateHeight();
    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(node);
    return () => resizeObserver.disconnect();
  }, [onHeightChange, originalContent, modifiedContent, diffStyle]);

  if (hasError) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Markdown preview unavailable
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Spinner size="sm" />
      </div>
    );
  }

  return (
    <div ref={rootRef} className="h-full overflow-auto bg-background-secondary-1">
      <div
        className={cn(
          'grid min-h-full',
          diffStyle === 'split' ? 'grid-cols-2 divide-x divide-border' : 'grid-cols-1'
        )}
      >
        <MarkdownPreviewPane
          label="Original"
          content={originalContent}
          resolveImage={resolveImage}
          className={diffStyle === 'unified' ? 'border-b border-border' : undefined}
        />
        <MarkdownPreviewPane
          label="Modified"
          content={modifiedContent}
          resolveImage={resolveImage}
        />
      </div>
    </div>
  );
});

interface MarkdownPreviewPaneProps {
  label: string;
  content: string;
  resolveImage: (src: string) => Promise<string | null>;
  className?: string;
}

function MarkdownPreviewPane({
  label,
  content,
  resolveImage,
  className,
}: MarkdownPreviewPaneProps) {
  return (
    <section className={cn('min-w-0', className)}>
      <div className="sticky top-0 z-10 border-b border-border bg-background-secondary-1/95 px-4 py-2 text-xs font-medium text-foreground-muted backdrop-blur">
        {label}
      </div>
      <MarkdownRenderer
        content={content}
        variant="full"
        className="w-full max-w-none px-6 py-5"
        resolveImage={resolveImage}
      />
    </section>
  );
}
