import type { ManagedFile } from './types';

interface ImageRendererProps {
  file: ManagedFile;
}

/** Renders raster image files (png, jpg, gif, webp, ico, bmp). */
export function ImageRenderer({ file }: ImageRendererProps) {
  const fileName = file.path.split('/').pop() ?? file.path;

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-4">
      <img src={file.content} alt={fileName} className="max-h-full max-w-full object-contain" />
    </div>
  );
}
