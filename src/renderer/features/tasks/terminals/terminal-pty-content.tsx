import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { PaneSizingProvider } from '@renderer/lib/pty/pane-sizing-context';
import { PtyPane } from '@renderer/lib/pty/pty-pane';
import { type PtySession } from '@renderer/lib/pty/pty-session';
import { TerminalSearchOverlay } from '@renderer/lib/pty/terminal-search-overlay';
import { useTerminalSearch } from '@renderer/lib/pty/use-terminal-search';
import { cssVar } from '@renderer/utils/cssVars';
import { cn } from '@renderer/utils/utils';

export interface TerminalPtyContentProps {
  activeSession: PtySession | null;
  allSessionIds: string[];
  paneId: string;
  autoFocus?: boolean;
  onFocusChange?: (focused: boolean) => void;
  onEnterPress?: () => void;
  onInterruptPress?: () => void;
  mapShiftEnterToCtrlJ?: boolean;
  emptyState: ReactNode;
  remoteConnectionId?: string;
  className?: string;
}

export const TerminalPtyContent = observer(function TerminalPtyContent({
  activeSession,
  allSessionIds,
  paneId,
  autoFocus,
  onFocusChange,
  onEnterPress,
  onInterruptPress,
  mapShiftEnterToCtrlJ,
  emptyState,
  remoteConnectionId,
  className,
}: TerminalPtyContentProps) {
  const activeSessionId = activeSession?.sessionId ?? null;

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<{ focus: () => void }>(null);
  const focusPendingRef = useRef(false);

  const {
    isSearchOpen,
    searchQuery,
    searchStatus,
    searchInputRef,
    closeSearch,
    handleSearchQueryChange,
    stepSearch,
  } = useTerminalSearch({
    terminal: activeSession?.pty?.terminal,
    containerRef: terminalContainerRef,
    enabled: Boolean(activeSession?.pty),
    onCloseFocus: () => terminalRef.current?.focus(),
  });

  // Fire when autoFocus becomes true or the active session changes.
  useEffect(() => {
    if (!autoFocus) return;
    if (terminalRef.current) {
      terminalRef.current.focus();
      focusPendingRef.current = false;
    } else {
      containerRef.current?.focus();
      focusPendingRef.current = true;
    }
  }, [autoFocus, activeSessionId]);

  // Fire when the session transitions to 'ready'.
  const sessionStatus = activeSession?.status;
  useEffect(() => {
    if (sessionStatus === 'ready' && focusPendingRef.current) {
      focusPendingRef.current = false;
      terminalRef.current?.focus();
    }
  }, [sessionStatus]);

  const sessionIds = useMemo(() => allSessionIds, [allSessionIds]);

  const hasSessions = sessionIds.length > 0;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className={cn('flex h-full flex-col outline-none', className)}
      onFocus={() => onFocusChange?.(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          onFocusChange?.(false);
        }
      }}
    >
      <PaneSizingProvider paneId={paneId} sessionIds={sessionIds}>
        {!hasSessions ? (
          emptyState
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {activeSessionId && activeSession?.status === 'ready' && activeSession.pty ? (
              <div ref={terminalContainerRef} className="relative flex h-full min-h-0 flex-1">
                <TerminalSearchOverlay
                  isOpen={isSearchOpen}
                  fullWidth
                  searchQuery={searchQuery}
                  searchStatus={searchStatus}
                  searchInputRef={searchInputRef}
                  onQueryChange={handleSearchQueryChange}
                  onStep={stepSearch}
                  onClose={closeSearch}
                />
                <PtyPane
                  ref={terminalRef}
                  sessionId={activeSessionId}
                  pty={activeSession.pty}
                  className="h-full w-full "
                  themeOverride={{
                    background: cssVar('--background'),
                  }}
                  onEnterPress={onEnterPress}
                  onInterruptPress={onInterruptPress}
                  mapShiftEnterToCtrlJ={mapShiftEnterToCtrlJ}
                  remoteConnectionId={remoteConnectionId}
                />
              </div>
            ) : null}
          </div>
        )}
      </PaneSizingProvider>
    </div>
  );
});
