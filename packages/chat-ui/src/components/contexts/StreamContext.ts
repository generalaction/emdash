/**
 * StreamContext — per-message streaming animation state.
 *
 * Provided by AssistantRender while a message is streaming; null for committed
 * messages so there is zero animation overhead in the non-streaming case.
 *
 * `frontier` maps blockId → number of words already committed on the previous
 * render. ProseFragment consults this to animate only the newly-appended tail,
 * not words that were already visible.
 *
 * The Map is shared by reference — Prose.tsx writes into it after each render
 * cycle (via onMount/createEffect), so the next streaming tick finds the
 * correct frontier without any extra reactivity.
 */

import { createContext, useContext } from 'solid-js';

export type StreamAnimation = {
  /** blockId → count of words that were already visible on the previous render. */
  frontier: Map<string, number>;
};

export const StreamContext = createContext<StreamAnimation | null>(null);

/** Returns the current StreamAnimation, or null outside a streaming row. */
export const useStreamAnimation = (): StreamAnimation | null => useContext(StreamContext);
