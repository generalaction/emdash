import { useState, useEffect, useRef } from 'react';

const SAMPLE_SIZE = 32;
const COLOR_THRESHOLD = 30;
const ALPHA_THRESHOLD = 10;

/**
 * Detects whether an image is monochrome (grayscale/black/white) or has color.
 * Used to conditionally apply dark:invert on skill icons — monochrome icons
 * get inverted in dark mode, while colorful icons (e.g. PDF red) stay as-is.
 *
 * Returns: true = monochrome, false = has color, null = still loading/unknown.
 */
export function useIsMonochrome(src: string | undefined): boolean | null {
  const [result, setResult] = useState<boolean | null>(null);
  const tested = useRef<string>();

  useEffect(() => {
    if (!src || tested.current === src) return;
    tested.current = src;

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = SAMPLE_SIZE;
      canvas.height = SAMPLE_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setResult(true);
        return;
      }
      ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      const data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;

      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < ALPHA_THRESHOLD) continue; // skip transparent pixels
        const r = data[i],
          g = data[i + 1],
          b = data[i + 2];
        if (
          Math.abs(r - g) > COLOR_THRESHOLD ||
          Math.abs(r - b) > COLOR_THRESHOLD ||
          Math.abs(g - b) > COLOR_THRESHOLD
        ) {
          setResult(false);
          return;
        }
      }
      setResult(true);
    };

    img.onerror = () => setResult(true);
    img.src = src;

    return () => {
      img.onload = null;
      img.onerror = null;
      img.src = '';
    };
  }, [src]);

  return result;
}
