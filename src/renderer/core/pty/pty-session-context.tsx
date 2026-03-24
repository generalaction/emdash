import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { frontendPtyRegistry } from './pty';

interface PtySessionContextValue {
  registerSession: (sessionId: string, startFn?: () => Promise<void>) => Promise<void>;
  unregisterSession: (sessionId: string) => void;
  /** Returns true once the FrontendPty for sessionId has been registered and is safe to mount. */
  isSessionReady: (sessionId: string) => boolean;
}

const PtySessionContext = createContext<PtySessionContextValue | null>(null);

export function PtySessionProvider({ children }: { children: ReactNode }) {
  // Ref for synchronous idempotency — safe in StrictMode (double-effect guard).
  const registeredRef = useRef<Set<string>>(new Set());
  // State mirrors the ref purely for reactivity — lets components subscribe to readiness.
  const [registeredSessions, setRegisteredSessions] = useState<ReadonlySet<string>>(new Set());

  const registerSession = useCallback(
    async (sessionId: string, startFn?: () => Promise<void>): Promise<void> => {
      if (registeredRef.current.has(sessionId)) return;
      registeredRef.current.add(sessionId);
      // Awaiting register() ensures the terminal is fully ready (historical
      // output written, direct writes active) before isSessionReady flips.
      await frontendPtyRegistry.register(sessionId);
      startFn?.().catch(() => {});
      setRegisteredSessions((prev) => new Set([...prev, sessionId]));
    },
    []
  );

  const unregisterSession = useCallback((sessionId: string) => {
    // frontendPtyRegistry.unregister() disposes the FrontendPty, which in turn
    // disposes the Terminal and removes the owned container from the DOM.
    frontendPtyRegistry.unregister(sessionId);
    registeredRef.current.delete(sessionId);
    setRegisteredSessions((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
  }, []);

  const isSessionReady = useCallback(
    (sessionId: string) => registeredSessions.has(sessionId),
    [registeredSessions]
  );

  return (
    <PtySessionContext.Provider value={{ registerSession, unregisterSession, isSessionReady }}>
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
