import { type Terminal } from '@xterm/xterm';
import { useCallback, useSyncExternalStore } from 'react';

export function useTerminalScrollAtBottom(terminal: Terminal | null | undefined): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!terminal) return () => {};
      const disp = terminal.onScroll(() => onStoreChange());
      return () => disp.dispose();
    },
    [terminal]
  );

  const getSnapshot = useCallback(() => {
    if (!terminal) return true;
    const buf = terminal.buffer.active;
    return buf.viewportY >= buf.baseY;
  }, [terminal]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
