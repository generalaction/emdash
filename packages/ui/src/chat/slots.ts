/**
 * Slot contract for the imperative chat renderer.
 *
 * Slots return either a plain DOM Node (just appended) or a
 * { mount, unmount } pair for slots that need lifecycle management
 * (e.g. KaTeX, Mermaid, syntax-highlighted code with their own observers).
 *
 * The engine calls unmount() before recycling or removing a row,
 * so slots can clean up internal state / React roots.
 */

import type { Block, IslandType } from './blocks/block-types';

/** Either a raw DOM node to append, or a mount/unmount lifecycle pair. */
export type MountResult = Node | { mount: (host: HTMLElement) => void; unmount?: () => void };

/** Normalise a MountResult into a mounted state and an unmount callback. */
export function applyMountResult(host: HTMLElement, result: MountResult): () => void {
  if (result instanceof Node) {
    host.appendChild(result);
    return () => {
      if (result.parentNode === host) host.removeChild(result);
    };
  }
  result.mount(host);
  return result.unmount ?? (() => {});
}

export type ChatSlots = {
  /** Override code block rendering. Return a DOM node or mount/unmount pair. */
  renderCode?: (block: Block & { tier: 'code' }) => MountResult;
  /** Override island rendering per type. */
  renderIsland?: Partial<Record<IslandType, (block: Block & { tier: 'island' }) => MountResult>>;
  /** Override mention chip: return a DOM Text/Element node. */
  renderMention?: (label: string, tone?: string) => Node;
};
