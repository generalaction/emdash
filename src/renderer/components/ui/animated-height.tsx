import { motion } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@renderer/lib/utils';

export function AnimatedHeight({
  children,
  className,
  onAnimatingChange,
}: {
  children: React.ReactNode;
  className?: string;
  onAnimatingChange?: (isAnimating: boolean) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const [isAnimating, setIsAnimating] = useState(false);

  // Measure the initial height synchronously before the first paint so
  // framer-motion starts with an explicit pixel value rather than 'auto'.
  // This prevents the auto→pixel animation that would otherwise run on mount.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    setHeight(el.offsetHeight);
  }, []);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    // Skip the ResizeObserver's initial callback — the height was already
    // captured synchronously above, so the first observation is never new.
    let isFirstCallback = true;
    const ro = new ResizeObserver(() => {
      if (isFirstCallback) {
        isFirstCallback = false;
        return;
      }
      setHeight(el.offsetHeight);
      setIsAnimating(true);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    onAnimatingChange?.(isAnimating);
  }, [isAnimating, onAnimatingChange]);

  return (
    <motion.div
      animate={{ height: height ?? 'auto' }}
      transition={{ duration: 0.25, ease: 'easeInOut' }}
      className={cn('w-full', isAnimating ? 'overflow-hidden' : 'overflow-visible', className)}
      onAnimationComplete={() => setIsAnimating(false)}
    >
      <div ref={contentRef}>{children}</div>
    </motion.div>
  );
}
