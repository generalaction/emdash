import { createContext, useContext } from 'react';

/**
 * Maps tabId -> 1-based tab-by-number digit while the shortcut modifier is
 * held. Null while hints are hidden. Provided by TabBar per pane.
 */
export const TabNumberHintsContext = createContext<ReadonlyMap<string, number> | null>(null);

export function useTabNumberHint(tabId: string): number | null {
  return useContext(TabNumberHintsContext)?.get(tabId) ?? null;
}
