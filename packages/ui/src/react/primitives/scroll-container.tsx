import * as React from 'react';
import { type ScrollFadeAxis, type ScrollFadeEdge, ScrollFade } from './scroll-fade';

export type ScrollContainerProps = {
  /** Which axis to observe and fade. Defaults to 'y'. */
  axis?: ScrollFadeAxis;
  /**
   * Maximum height of the container. Numbers are interpreted as pixels.
   * When content is shorter than this value the container shrinks to fit
   * and no fades are rendered. When content exceeds it the container scrolls
   * and edge fades appear automatically.
   */
  maxHeight?: number | string;
  /** Show the top fade when scrolled down. Defaults to true. */
  topFade?: boolean;
  /** Show the bottom fade when content overflows below. Defaults to true. */
  bottomFade?: boolean;
  /** Show the left fade when scrolled right. Defaults to true. */
  leftFade?: boolean;
  /** Show the right fade when content overflows to the right. Defaults to true. */
  rightFade?: boolean;
  size?: number | string;
  fadeColor?: string;
  className?: string;
  viewportClassName?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

/**
 * ScrollContainer wraps ScrollFade with JS-driven overflow detection so that
 * fade overlays are only rendered when the content actually overflows. This
 * fixes the CSS-only limitation where the bottom fade is always visible
 * (its scroll-driven animation starts at opacity 1 when content fits).
 *
 * The CSS scroll-driven animations in overflow-fade.css still control which
 * rendered fade is *visible* based on scroll position — no scroll listener
 * is needed here.
 */
const ScrollContainer = React.forwardRef<HTMLDivElement, ScrollContainerProps>(
  function ScrollContainer(
    {
      axis = 'y',
      maxHeight,
      topFade = true,
      bottomFade = true,
      leftFade = true,
      rightFade = true,
      size,
      fadeColor,
      className,
      viewportClassName,
      style,
      children,
    },
    ref
  ) {
    const [overflowY, setOverflowY] = React.useState(false);
    const [overflowX, setOverflowX] = React.useState(false);
    const viewportRef = React.useRef<HTMLDivElement>(null);

    // Merge forwarded ref with internal ref.
    React.useImperativeHandle(ref, () => viewportRef.current as HTMLDivElement);

    React.useLayoutEffect(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      function measure() {
        if (!viewport) return;
        setOverflowY(viewport.scrollHeight > viewport.clientHeight + 1);
        setOverflowX(viewport.scrollWidth > viewport.clientWidth + 1);
      }

      measure();

      const ro = new ResizeObserver(measure);
      ro.observe(viewport);
      // Also observe the first content child so that dynamic content changes
      // (e.g. items added/removed) trigger a re-measure.
      const firstChild = viewport.firstElementChild;
      if (firstChild) ro.observe(firstChild);

      return () => ro.disconnect();
    }, [children]);

    // Build the edges array based on real overflow + per-edge toggles.
    const edges: ScrollFadeEdge[] = [];
    if (axis === 'y' || axis === 'both') {
      if (overflowY) {
        if (topFade) edges.push('top');
        if (bottomFade) edges.push('bottom');
      }
    }
    if (axis === 'x' || axis === 'both') {
      if (overflowX) {
        if (leftFade) edges.push('left');
        if (rightFade) edges.push('right');
      }
    }

    const resolvedMaxHeight =
      maxHeight === undefined
        ? undefined
        : typeof maxHeight === 'number'
          ? `${maxHeight}px`
          : maxHeight;

    // maxHeight must target the scrollable viewport div (not the outer wrapper).
    // If applied to the wrapper only, `height: 100%` on the viewport resolves
    // to `auto` (no definite parent height), so the viewport never scrolls.
    const viewportStyle: React.CSSProperties | undefined = resolvedMaxHeight
      ? { maxHeight: resolvedMaxHeight }
      : undefined;

    return (
      <ScrollFade
        ref={viewportRef}
        axis={axis}
        edges={edges}
        size={size}
        fadeColor={fadeColor}
        className={className}
        viewportClassName={viewportClassName}
        viewportStyle={viewportStyle}
        style={style}
      >
        {children}
      </ScrollFade>
    );
  }
);

export { ScrollContainer };
