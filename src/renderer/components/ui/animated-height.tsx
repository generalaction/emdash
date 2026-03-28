import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
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

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
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
