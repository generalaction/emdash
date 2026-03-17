import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { terminalPool } from './pty-pool';
import { ensureXtermHost } from './xterm-host';

const TerminalPoolContext = createContext(terminalPool);

/**
 * Mounts the off-screen terminal host element and provides the terminal pool
 * singleton to the React tree.  Should be placed high in App.tsx so it
 * outlives all TerminalPane instances.
 */
export function TerminalPoolProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    ensureXtermHost();
    return () => {
      terminalPool.disposeAll();
    };
  }, []);

  return (
    <TerminalPoolContext.Provider value={terminalPool}>{children}</TerminalPoolContext.Provider>
  );
}

export function useTerminalPool() {
  return useContext(TerminalPoolContext);
}
