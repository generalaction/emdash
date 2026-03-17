import { createContext, useCallback, useContext, useRef, type ReactNode } from 'react';
import { frontendPtyRegistry } from './pty';
import { terminalPool } from './pty-pool';

interface PtySessionContextValue {
  /**
   * Register a FrontendPty listener for the given session ID.
   *
   * Idempotent: returns `false` (and is a no-op) if the session has already
   * been registered. Returns `true` when the session is newly registered —
   * callers can gate side-effects (e.g. `rpc.conversations.startSession`) on
   * this return value to avoid running them twice.
   *
   * Must be called BEFORE the RPC that spawns the PTY so no output is missed.
   */
  registerSession: (sessionId: string) => boolean;
  /**
   * Dispose the FrontendPty and xterm Terminal for the given session.
   * Resets the idempotency guard so the session can be re-registered later.
   */
  unregisterSession: (sessionId: string) => void;
}

const PtySessionContext = createContext<PtySessionContextValue | null>(null);

export function PtySessionProvider({ children }: { children: ReactNode }) {
  const registeredRef = useRef<Set<string>>(new Set());

  const registerSession = useCallback((sessionId: string): boolean => {
    if (registeredRef.current.has(sessionId)) return false;
    frontendPtyRegistry.register(sessionId);
    registeredRef.current.add(sessionId);
    return true;
  }, []);

  const unregisterSession = useCallback((sessionId: string) => {
    frontendPtyRegistry.unregister(sessionId);
    terminalPool.dispose(sessionId);
    registeredRef.current.delete(sessionId);
  }, []);

  return (
    <PtySessionContext.Provider value={{ registerSession, unregisterSession }}>
      {children}
    </PtySessionContext.Provider>
  );
}

export function usePtySession(): PtySessionContextValue {
  const ctx = useContext(PtySessionContext);
  if (!ctx) {
    throw new Error('usePtySession must be used within a PtySessionProvider');
  }
  return ctx;
}
