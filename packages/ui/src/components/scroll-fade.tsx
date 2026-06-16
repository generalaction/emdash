import * as React from 'react';
import { cn } from '../lib/cn';

export type ScrollFadeAxis = 'y' | 'x' | 'both';

export type ScrollFadeProps = {
  /** Which axis to fade. Defaults to 'y'. */
  axis?: ScrollFadeAxis;
  /**
   * Override the fade gradient size. Accepts any CSS length string ('32px', '2rem')
   * or a number interpreted as pixels. Defaults to the fade.size token (24px).
   */
  size?: number | string;
  /**
   * Override the fade gradient color. Defaults to var(--surface) from the surface cascade.
   * Use this for containers whose background is not the surface color
   * (e.g. '--fade-color: var(--chat-code-bg)').
   */
  fadeColor?: string;
  className?: string;
  viewportClassName?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

/**
 * ScrollFade wraps a scrollable viewport with surface-cascade-aware edge fades.
 * Fades are driven by CSS scroll-driven animations — they appear only on edges
 * with hidden content, with no JavaScript required.
 *
 * The viewport ref is forwarded so callers can programmatically scroll it.
 *
 * @example
 * // Vertical fade (default) — matches the current surface automatically.
 * <ScrollFade className="h-64">
 *   <VeryLongList />
 * </ScrollFade>
 *
 * @example
 * // Horizontal, custom size and non-surface background.
 * <ScrollFade axis="x" size={40} fadeColor="var(--chat-code-bg)" className="w-full">
 *   <HorizontalContent />
 * </ScrollFade>
 */
const ScrollFade = React.forwardRef<HTMLDivElement, ScrollFadeProps>(function ScrollFade(
  { axis = 'y', size, fadeColor, className, viewportClassName, style, children },
  ref
) {
  const fadeSize = size === undefined ? undefined : typeof size === 'number' ? `${size}px` : size;

  const wrapperStyle: React.CSSProperties = {
    ...style,
    ...(fadeSize ? ({ '--fade-size': fadeSize } as React.CSSProperties) : {}),
    ...(fadeColor ? ({ '--fade-color': fadeColor } as React.CSSProperties) : {}),
  };

  const showY = axis === 'y' || axis === 'both';
  const showX = axis === 'x' || axis === 'both';

  return (
    <div className={cn('scroll-fade', className)} style={wrapperStyle}>
      <div ref={ref} className={cn('scroll-fade__viewport h-full w-full', viewportClassName)}>
        {children}
      </div>
      {showY && <div className="scroll-fade__top" aria-hidden="true" />}
      {showY && <div className="scroll-fade__bottom" aria-hidden="true" />}
      {showX && <div className="scroll-fade__left" aria-hidden="true" />}
      {showX && <div className="scroll-fade__right" aria-hidden="true" />}
    </div>
  );
});

export { ScrollFade };
