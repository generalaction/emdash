import { useState, useEffect, useCallback } from 'react';
import { pendingInjectionManager } from '../lib/PendingInjectionManager';

/**
 * React hook for accessing the pending injection manager
 * Provides reactive state that updates when pending text changes
 */
export function usePendingInjection() {
  const [pendingText, setPendingText] = useState<string | null>(
    pendingInjectionManager.getPending()
  );

  useEffect(() => {
    // Subscribe to changes
    const unsubscribe = pendingInjectionManager.subscribe(() => {
      setPendingText(pendingInjectionManager.getPending());
    });
    return unsubscribe;
  }, []);

  const setPending = useCallback((text: string) => {
    pendingInjectionManager.setPending(text);
  }, []);

  const clear = useCallback(() => {
    pendingInjectionManager.clear();
  }, []);

  const sendNow = useCallback(async (ptyId: string, text: string) => {
    // Use carriage return to mimic Enter key for immediate submit.
    await window.electronAPI.ptyInput({ id: ptyId, data: text + '\r' });
  }, []);

  const onInjectionUsed = useCallback((callback: () => void) => {
    return pendingInjectionManager.onInjectionUsed(callback);
  }, []);

  return {
    pendingText,
    hasPending: pendingText !== null,
    setPending,
    clear,
    sendNow,
    onInjectionUsed,
  };
}
