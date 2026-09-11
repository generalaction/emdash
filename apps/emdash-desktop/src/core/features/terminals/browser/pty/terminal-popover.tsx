import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@core/primitives/styling/browser/cn';

/**
 * Floating menu plate for terminal link overlays (file popovers, selection
 * menu). xterm surfaces expose raw viewport coordinates rather than React
 * anchors, so positioning is computed from client coordinates with viewport
 * flipping; standard anchor-based popovers don't fit that geometry.
 */
export interface TerminalPopoverProps {
  visible: boolean;
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
}

export const TerminalPopover: React.FC<TerminalPopoverProps> = ({
  visible,
  x,
  y,
  onClose,
  children,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!visible || !ref.current) return;

    const rect = ref.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    let top = y;
    let left = x;

    if (top + rect.height > viewportHeight - 10) {
      top = y - rect.height;
    }

    if (left + rect.width > viewportWidth - 10) {
      left = viewportWidth - rect.width - 10;
    }

    if (left < 10) {
      left = 10;
    }

    if (top < 10) {
      top = 10;
    }

    setPosition({ top, left });
  }, [visible, x, y]);

  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [visible, onClose]);

  if (!visible) return null;

  return createPortal(
    <div
      ref={ref}
      className="surface-elevated fixed z-[10001] max-h-[calc(100vh-20px)] w-max max-w-[calc(100vw-20px)] min-w-[180px] overflow-y-auto rounded-lg py-1 shadow-lg ring-1 ring-foreground/10"
      style={{ left: position.left, top: position.top }}
    >
      {children}
    </div>,
    document.body
  );
};

TerminalPopover.displayName = 'TerminalPopover';

export interface PopoverButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

export const PopoverButton: React.FC<PopoverButtonProps> = ({ className, children, ...props }) => {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-background-2 focus:bg-background-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
};

PopoverButton.displayName = 'PopoverButton';
