import { useEffect, useLayoutEffect, useRef } from 'react';
import { pendingInjectionManager } from '../lib/PendingInjectionManager';

/**
 * Generic hook that syncs an array of items to a named PendingInjectionManager source.
 * Items are formatted and set as pending; when the injection is consumed, onConsumed fires.
 *
 * @param source   Named key in PendingInjectionManager (e.g. 'diff-comments', 'pr-comments')
 * @param items    Reactive array of items to inject (empty = nothing pending)
 * @param formatter Converts items to a string for injection (return '' to skip)
 * @param onConsumed Called after the injection is used — clear the source store here
 * @param enabled  When false, the source is cleared and no injection is set (default: true)
 */
export function useInjectionSource<T>(
  source: string,
  items: T[],
  formatter: (items: T[]) => string,
  onConsumed: () => void,
  enabled = true
): void {
  const hasPendingRef = useRef(false);
  const onConsumedRef = useRef(onConsumed);
  useLayoutEffect(() => {
    onConsumedRef.current = onConsumed;
  });

  useEffect(() => {
    if (!enabled || items.length === 0) {
      if (hasPendingRef.current) {
        pendingInjectionManager.clear(source);
        hasPendingRef.current = false;
      }
      return;
    }

    const formatted = formatter(items);
    if (formatted) {
      pendingInjectionManager.setPending(formatted, source);
      hasPendingRef.current = true;
    } else if (hasPendingRef.current) {
      pendingInjectionManager.clear(source);
      hasPendingRef.current = false;
    }

    return () => {
      if (hasPendingRef.current) {
        pendingInjectionManager.clear(source);
        hasPendingRef.current = false;
      }
    };
  }, [items, source, enabled, formatter]);

  useEffect(() => {
    if (!enabled) return;
    return pendingInjectionManager.onInjectionUsed(() => {
      onConsumedRef.current();
      hasPendingRef.current = false;
    });
  }, [enabled]);
}
