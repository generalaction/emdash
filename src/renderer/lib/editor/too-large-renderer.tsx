import { FileX } from 'lucide-react';
import type { ManagedFile } from './types';

interface TooLargeRendererProps {
  file: ManagedFile;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Shown when a file exceeds the editor's read limit. */
export function TooLargeRenderer({ file }: TooLargeRendererProps) {
  const fileName = file.path.split('/').pop() ?? file.path;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <FileX className="h-10 w-10 opacity-30" />
      <div className="text-center">
        <p className="text-sm font-medium">{fileName}</p>
        <p className="mt-1 text-xs opacity-70">File too large to display in the editor</p>
        {file.totalSize != null && (
          <p className="mt-0.5 text-xs opacity-50">{formatBytes(file.totalSize)}</p>
        )}
      </div>
    </div>
  );
}
