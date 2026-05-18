import { FileWarning, Loader2 } from 'lucide-react';
import { useMemo } from 'react';

interface PdfRendererProps {
  file: { path: string; content: string; isLoading: boolean };
}

function dataUrlToBlobUrl(dataUrl: string) {
  const [header, base64] = dataUrl.split(',');
  const mimeType = header.match(/^data:([^;]+)/)?.[1] ?? 'application/pdf';
  if (!base64) return null;

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

/** Renders PDF files using the browser's built-in PDF viewer. */
export function PdfRenderer({ file }: PdfRendererProps) {
  const fileName = file.path.split('/').pop() ?? file.path;
  const blobUrl = useMemo(() => dataUrlToBlobUrl(file.content), [file.content]);

  if (file.isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Loading PDF…</p>
      </div>
    );
  }

  if (!blobUrl) {
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
      <iframe className="h-full w-full border-0" src={blobUrl} title={fileName} />
    </div>
  );
}
