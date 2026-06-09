import { useEffect, type ReactNode } from 'react';
import { disposeAllPtys } from './pty';
import { ensureXtermHost } from './xterm-host';

export function TerminalPoolProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    ensureXtermHost();
    return () => {
      disposeAllPtys();
    };
  }, []);

  return <>{children}</>;
}
