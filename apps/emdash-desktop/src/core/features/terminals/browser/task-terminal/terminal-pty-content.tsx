import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { PaneSizingContextProvider } from '@core/features/terminals/api/browser/pty/pane-sizing-context';
import { TERMINAL_PADDING_PX } from '@core/features/terminals/api/browser/pty/pty';
import { PtyPane } from '@core/features/terminals/api/browser/pty/pty-pane';
import { type PtySession } from '@core/features/terminals/api/browser/pty/pty-session';
import { TerminalSearchOverlay } from '@core/features/terminals/api/browser/pty/terminal-search-overlay';
import { useTerminalSearch } from '@core/features/terminals/api/browser/pty/use-terminal-search';
import { cn } from '@core/primitives/ui/browser/cn';
import {
  createPaneDimensionSink,
  PaneDimensionProvider,
} from '@core/primitives/workbench-shell/browser/tabs/pane-dimension-provider';
import { cssVar } from '@renderer/utils/cssVars';

export interface TerminalPtyContentProps {
  activeSession: PtySession | null;
  allSessionIds: string[];
  autoFocus?: boolean;
  onFocusChange?: (focused: boolean) => void;
  onEnterPress?: () => void;
  onInterruptPress?: () => void;
  mapShiftEnterToCtrlJ?: boolean;
  emptyState: ReactNode;
  remoteConnectionId?: string;
  workspaceId: string;
  /** Defaults to the standard uniform xterm inset. */
  terminalPaddingBottom?: number;
  className?: string;
}

export const TerminalPtyContent = observer(function TerminalPtyContent({
  activeSession,
  allSessionIds,
  autoFocus,
  onFocusChange,
  onEnterPress,
  onInterruptPress,
  mapShiftEnterToCtrlJ,
  emptyState,
  remoteConnectionId,
  workspaceId,
  terminalPaddingBottom = TERMINAL_PADDING_PX,
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
    openSearch,
    closeSearch,
    handleSearchQueryChange,
    stepSearch,
  } = useTerminalSearch({
    terminal: activeSession?.pty?.terminal,
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
  const dimensionSink = useMemo(() => createPaneDimensionSink(), []);
  // The resize controller already accounts for uniform padding; pass only the
  // delta so its row count stays aligned with the drawer-specific CSS inset.
  const gridBottomPadding = terminalPaddingBottom - TERMINAL_PADDING_PX;

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
      <PaneDimensionProvider sink={dimensionSink}>
        <PaneSizingContextProvider sessionIds={sessionIds} bottomPadding={gridBottomPadding}>
          {!hasSessions || !activeSession ? (
            emptyState
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              {activeSessionId && activeSession?.status === 'ready' && activeSession.pty ? (
                <div ref={terminalContainerRef} className="relative flex h-full min-h-0 flex-1">
                  <TerminalSearchOverlay
                    sessionId={activeSessionId}
                    isOpen={isSearchOpen}
                    fullWidth
                    searchQuery={searchQuery}
                    searchStatus={searchStatus}
                    searchInputRef={searchInputRef}
                    onQueryChange={handleSearchQueryChange}
                    onStep={stepSearch}
                    onFind={openSearch}
                    onClose={closeSearch}
                  />
                  <PtyPane
                    ref={terminalRef}
                    sessionId={activeSessionId}
                    pty={activeSession.pty}
                    onFind={openSearch}
                    className="h-full w-full"
                    themeOverride={{
                      background: cssVar('--background'),
                    }}
                    paddingBottom={terminalPaddingBottom}
                    onEnterPress={onEnterPress}
                    onInterruptPress={onInterruptPress}
                    mapShiftEnterToCtrlJ={mapShiftEnterToCtrlJ}
                    remoteConnectionId={remoteConnectionId}
                    workspaceId={workspaceId}
                  />
                </div>
              ) : null}
            </div>
          )}
        </PaneSizingContextProvider>
      </PaneDimensionProvider>
    </div>
  );
});
