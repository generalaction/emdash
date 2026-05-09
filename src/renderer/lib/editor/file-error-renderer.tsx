import { FileX2 } from 'lucide-react';

interface FileErrorRendererProps {
  file: { path: string };
}

/** Shown when a file could not be loaded (e.g. file not found or read error). */
export function FileErrorRenderer({ file }: FileErrorRendererProps) {
  const fileName = file.path.split('/').pop() ?? file.path;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground bg-background-secondary-1">
      <FileX2 className="h-10 w-10 opacity-30" />
      <div className="text-center">
        <p className="text-sm font-medium">{fileName}</p>
        <p className="mt-1 text-xs opacity-70">File not found or could not be read</p>
      </div>
    </div>
  );
}
