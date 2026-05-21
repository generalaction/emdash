import { FileWarning, Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';

interface PdfRendererProps {
  file: { path: string; content: string; isLoading: boolean };
}

/** Renders PDF files using the browser's built-in PDF viewer. */
export const PdfRenderer = observer(function PdfRenderer({ file }: PdfRendererProps) {
  const fileName = file.path.split('/').pop() ?? file.path;

  if (file.isLoading) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Loading PDF…</p>
      </div>
    );
  }

  if (!file.content) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3">
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
      <object className="h-full w-full" data={file.content} title={fileName} type="application/pdf">
        <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3">
          <FileWarning className="h-10 w-10 opacity-30" />
          <div className="text-center">
            <p className="text-sm font-medium">{fileName}</p>
            <p className="mt-1 text-xs opacity-70">PDF preview unavailable</p>
          </div>
        </div>
      </object>
    </div>
  );
});
