import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@core/primitives/styling/browser/cn';

export interface TerminalLinkTooltipProps {
  visible: boolean;
  x: number;
  y: number;
  linkText: string;
  hint: string;
}

const GAP = 8;
const MARGIN = 8;

/**
 * Tooltip for xterm file-link hovers: portaled at the raw mouse coordinates
 * xterm reports, showing the resolved path plus the activation-modifier hint.
 */
export const TerminalLinkTooltip: React.FC<TerminalLinkTooltipProps> = ({
  visible,
  x,
  y,
  linkText,
  hint,
}) => {
  const [style, setStyle] = useState<React.CSSProperties>({
    visibility: 'hidden',
    opacity: 0,
  });
  const tooltipRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!visible || !tooltipRef.current) {
      setStyle({ visibility: 'hidden', opacity: 0 });
      return;
    }

    const tooltip = tooltipRef.current;
    const rect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = y + GAP;
    let left = x;

    if (top + rect.height + MARGIN > viewportHeight) {
      top = y - rect.height - GAP;
    }

    if (left + rect.width + MARGIN > viewportWidth) {
      left = viewportWidth - rect.width - MARGIN;
    }
    if (left < MARGIN) {
      left = MARGIN;
    }

    setStyle({
      top,
      left,
      visibility: 'visible',
      opacity: 1,
    });
  }, [visible, x, y, linkText, hint]);

  if (!visible) return null;

  return createPortal(
    <div
      ref={tooltipRef}
      className={cn(
        'surface-elevated pointer-events-none fixed z-[10000] max-w-md rounded-lg px-3 py-2 shadow-lg ring-1 ring-foreground/10 transition-opacity'
      )}
      style={style}
      role="tooltip"
    >
      <div className="flex flex-col gap-1">
        <div className="truncate text-sm font-medium text-foreground">{linkText}</div>
        <div className="text-xs text-foreground-muted">{hint}</div>
      </div>
    </div>,
    document.body
  );
};

TerminalLinkTooltip.displayName = 'TerminalLinkTooltip';
