import { useEffect, type ReactNode } from 'react';
import { disposeAllPtys } from './pty';
import { ensureXtermHost } from './xterm-host';

/**
 * Mounts the off-screen terminal host element and disposes all FrontendPty
 * instances on unmount.  Should be placed high in App.tsx so it outlives all
 * TerminalPane instances.
 */
export function TerminalPoolProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    ensureXtermHost();
    return () => {
      disposeAllPtys();
    };
  }, []);

  return <>{children}</>;
}
