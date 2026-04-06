import React, { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Minimize2 } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { TITLEBAR_HEIGHT } from '../constants/layout';
import { terminalSessionRegistry } from '../terminal/SessionRegistry';
import { shouldCloseExpandedTerminal } from '../lib/expandedTerminal';

interface Props {
  terminalId: string;
  title?: string;
  onClose: () => void;
  variant?: 'dark' | 'light';
}

/**
 * Full-screen modal overlay that re-attaches an existing terminal session.
 * The session is detached from the mini terminal in the sidebar and attached
 * to this modal's container. On close, the session returns to the sidebar.
 */
const ExpandedTerminalModal: React.FC<Props> = ({ terminalId, title, onClose, variant }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Attach terminal session to the modal container on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !terminalId) return;

    // Attach to this modal's container — attach() internally detaches first
    const session = terminalSessionRegistry.reattach(terminalId, container);

    // Focus the terminal after DOM settles — double rAF ensures xterm has
    // opened and fitted before we try to grab focus.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        session?.focus();
      });
    });

    return () => {
      // On unmount, detach from modal — TerminalPane in sidebar will re-attach
      terminalSessionRegistry.detach(terminalId);
    };
  }, [terminalId]);

  // Capture Escape at window level so the modal closes even when xterm has focus.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!shouldCloseExpandedTerminal(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    },
    [onClose]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  const isDark = variant === 'dark';

  return createPortal(
    <div
      className="fixed inset-0 z-[900] flex flex-col"
      data-expanded-terminal="true"
      aria-label="Expanded terminal"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal content — top margin clears the titlebar / traffic lights */}
      <div
        className={cn(
          'relative z-10 mx-4 mb-4 flex flex-1 flex-col overflow-hidden rounded-lg border shadow-2xl',
          isDark ? 'border-zinc-700 bg-zinc-900' : 'border-border bg-background'
        )}
        style={{ marginTop: `calc(${TITLEBAR_HEIGHT} + 8px)` }}
      >
        {/* Header */}
        <div
          className={cn(
            'flex items-center justify-between border-b px-4 py-2',
            isDark ? 'border-zinc-700' : 'border-border'
          )}
        >
          <span
            className={cn(
              'text-xs font-medium',
              isDark ? 'text-zinc-300' : 'text-muted-foreground'
            )}
          >
            {title || 'Terminal'}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className={cn(
              isDark
                ? 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                : 'text-muted-foreground hover:text-foreground'
            )}
            title="Collapse terminal (Esc)"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Match the embedded terminal inset so expanded mode does not render flush to the modal edge. */}
        <div
          className={cn(
            'flex-1 overflow-hidden p-2 pt-1',
            isDark ? 'bg-zinc-900' : 'bg-background'
          )}
          onClick={() => {
            const session = terminalSessionRegistry.getSession(terminalId);
            session?.focus();
          }}
        >
          <div ref={containerRef} className="h-full w-full overflow-hidden" />
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ExpandedTerminalModal;
