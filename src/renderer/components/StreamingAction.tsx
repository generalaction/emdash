import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export const StreamingAction: React.FC<{
  text: string;
  className?: string;
  dotSpeedMs?: number;
}> = ({ text, className, dotSpeedMs = 500 }) => {
  const [display, setDisplay] = useState(text);
  const [dots, setDots] = useState(1);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (display === text) return;
    const el = ref.current;
    if (!el) {
      setDisplay(text);
      return;
    }

    const out = el.animate(
      [
        { transform: 'perspective(600px) rotateX(0deg)', opacity: 1 },
        { transform: 'perspective(600px) rotateX(90deg)', opacity: 0 },
      ],
      { duration: 220, easing: 'ease-in' }
    );
    out.onfinish = () => {
      setDisplay(text);
      setDots(1);
      requestAnimationFrame(() => {
        const el2 = ref.current;
        if (!el2) return;
        el2.animate(
          [
            { transform: 'perspective(600px) rotateX(-90deg)', opacity: 0 },
            { transform: 'perspective(600px) rotateX(0deg)', opacity: 1 },
          ],
          { duration: 260, easing: 'ease-out' }
        );
      });
    };
  }, [text, display]);

  useEffect(() => {
    const id = window.setInterval(
      () => {
        setDots((d) => (d % 3) + 1);
      },
      Math.max(200, dotSpeedMs)
    );
    return () => window.clearInterval(id);
  }, [display, dotSpeedMs]);

  if (!display) return null;
  return (
    <div ref={ref} className={cn('mt-2 origin-top text-code text-muted-foreground', className)}>
      <span className="shimmer-text">{display}</span>
      <span aria-hidden className="ml-1">
        {'.'.repeat(dots)}
      </span>
    </div>
  );
};

export default StreamingAction;
