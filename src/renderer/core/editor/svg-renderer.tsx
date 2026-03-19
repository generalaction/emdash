import { useEffect, useMemo } from 'react';
import type { ManagedFile } from '@renderer/hooks/useFileManager';

interface SvgRendererProps {
  file: ManagedFile;
}

/**
 * Renders SVG files as an image by default.
 * Creates a Blob URL from the SVG text content so that relative references
 * inside the SVG still resolve correctly, then revokes it on cleanup.
 */
export function SvgRenderer({ file }: SvgRendererProps) {
  // Create the blob URL synchronously via useMemo to avoid storing it in state.
  const svgUrl = useMemo(
    () =>
      file.content ? URL.createObjectURL(new Blob([file.content], { type: 'image/svg+xml' })) : '',
    [file.content]
  );

  // Revoke the previous blob URL whenever svgUrl changes or on unmount.
  useEffect(() => {
    return () => {
      if (svgUrl) URL.revokeObjectURL(svgUrl);
    };
  }, [svgUrl]);

  const fileName = file.path.split('/').pop() ?? file.path;

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-4">
      <img src={svgUrl} alt={fileName} className="max-h-full max-w-full object-contain" />
    </div>
  );
}
