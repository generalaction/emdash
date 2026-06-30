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
 *
 * `streaming` is a reactive accessor that reflects the parent message's
 * streaming flag. Code.tsx (and Diff.tsx) read it inside their highlight
 * effects so they can skip per-frame highlighting while streaming and run
 * exactly one full highlight when the accessor flips to false (message commits).
 * Using an accessor (not a plain boolean in the context value) is necessary
 * because Solid context values are not reactive when swapped.
 */

import { createContext, useContext } from 'solid-js';
import type { Accessor } from 'solid-js';

export type StreamAnimation = {
  /** blockId → count of words that were already visible on the previous render. */
  frontier: Map<string, number>;
  /**
   * Reactive accessor: true while the parent message is still streaming,
   * false once the message commits. Read inside effects that should be
   * deferred until streaming ends (e.g. Shiki highlighting).
   */
  streaming: Accessor<boolean>;
};

export const StreamContext = createContext<StreamAnimation | null>(null);

/** Returns the current StreamAnimation, or null outside a streaming row. */
export const useStreamAnimation = (): StreamAnimation | null => useContext(StreamContext);
