import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { terminalPool } from '../core/terminals/terminal-pool';
import { ensureTerminalHost } from './terminalHost';

export type { SessionTheme, LeaseOptions, LeaseResult } from '../core/terminals/terminal-pool';

const TerminalPoolContext = createContext(terminalPool);

/**
 * Mounts the off-screen terminal host element and provides the terminal pool
 * singleton to the React tree.  Should be placed high in App.tsx so it
 * outlives all TerminalPane instances.
 */
export function TerminalPoolProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    ensureTerminalHost();
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
