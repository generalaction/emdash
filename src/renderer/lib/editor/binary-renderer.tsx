import { FileQuestion } from 'lucide-react';
import { basenameAny, extnameAny } from '@renderer/utils/path-name';

interface BinaryRendererProps {
  file: { path: string };
}

/** Shown for binary or otherwise unsupported files. */
export function BinaryRenderer({ file }: BinaryRendererProps) {
  const fileName = basenameAny(file.path) || file.path;
  const ext = extnameAny(file.path).slice(1).toUpperCase() || undefined;

  return (
    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3">
      <FileQuestion className="h-10 w-10 opacity-30" />
      <div className="text-center">
        <p className="text-sm font-medium">{fileName}</p>
        {ext && <p className="mt-0.5 text-xs opacity-50">{ext} file</p>}
        <p className="mt-1 text-xs opacity-70">Binary file — no preview available</p>
      </div>
    </div>
  );
}
