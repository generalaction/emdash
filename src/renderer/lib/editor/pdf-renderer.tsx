import { FileWarning, Loader2 } from 'lucide-react';

interface PdfRendererProps {
  file: { path: string; content: string; isLoading: boolean };
}

/** Renders PDF files using the browser's built-in PDF viewer. */
export function PdfRenderer({ file }: PdfRendererProps) {
  const fileName = file.path.split('/').pop() ?? file.path;

  if (file.isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Loading PDF…</p>
      </div>
    );
  }

  if (!file.content) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <FileWarning className="h-10 w-10 opacity-30" />
        <div className="text-center">
          <p className="text-sm font-medium">{fileName}</p>
          <p className="mt-1 text-xs opacity-70">PDF preview unavailable</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden bg-background">
      <iframe className="h-full w-full border-0" src={file.content} title={fileName} />
    </div>
  );
}
