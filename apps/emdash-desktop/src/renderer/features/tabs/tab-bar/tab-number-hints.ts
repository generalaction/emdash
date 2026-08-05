import type { Hotkey } from '@tanstack/react-hotkeys';
import { createContext, useContext } from 'react';

/**
 * Maps tabId -> full tab-by-number hotkey (e.g. 'Control+2') while the
 * shortcut modifier is held. Null while hints are hidden. Provided by TabBar
 * per pane.
 */
export const TabNumberHintsContext = createContext<ReadonlyMap<string, Hotkey> | null>(null);

export function useTabNumberHint(tabId: string): Hotkey | null {
  return useContext(TabNumberHintsContext)?.get(tabId) ?? null;
}
