import { useEffect, type ReactNode } from 'react';
import { disposeAllPtys, prefetchTerminalSettings } from './pty';
import { ensureXtermHost } from './xterm-host';

// Kick off the terminal-settings prefetch as soon as this module loads so the
// cached fontFamily is available before the first FrontendPty is constructed.
void prefetchTerminalSettings();

export function TerminalPoolProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    ensureXtermHost();
    void prefetchTerminalSettings();
    return () => {
      disposeAllPtys();
    };
  }, []);

  return <>{children}</>;
}
