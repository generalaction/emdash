import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Hook that measures the pixel width of the referenced element and returns
 * an updater function.  Uses ResizeObserver for efficient live updates.
 *
 * @returns [ref, width] — attach ref to the scroll container element.
 */
export function useContentWidth(): [React.RefCallback<HTMLElement | null>, number] {
  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);

  const ref = useCallback((el: HTMLElement | null) => {
    // Disconnect from the old element
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    elementRef.current = el;
    if (!el) {
      setWidth(0);
      return;
    }

    // Snapshot current width immediately
    setWidth(el.clientWidth);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(Math.floor(entry.contentRect.width));
      }
    });
    ro.observe(el);
    observerRef.current = ro;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  return [ref, width];
}
