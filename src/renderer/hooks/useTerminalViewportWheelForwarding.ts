import { useCallback, type RefObject, type WheelEventHandler } from 'react';
import type { TerminalPaneHandle } from '../components/TerminalPane';

export function useTerminalViewportWheelForwarding(
  terminalRef: RefObject<TerminalPaneHandle | null>
): WheelEventHandler<HTMLDivElement> {
  return useCallback(
    (event) => {
      if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return;
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;

      const target = event.target;
      if (target instanceof Element && target.closest('[data-terminal-container]')) {
        return;
      }

      const didScroll =
        terminalRef.current?.scrollViewportFromWheelDelta(event.deltaY, event.deltaMode) ?? false;
      if (didScroll) {
        event.preventDefault();
      }
    },
    [terminalRef]
  );
}
