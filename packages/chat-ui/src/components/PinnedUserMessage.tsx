/**
 * PinnedUserMessage — a non-virtualized copy of a user message row, rendered
 * as the pinned-header overlay in ChatRoot when `pinUserMessages` is enabled.
 *
 * Mirrors Row.tsx geometry for user-role messages:
 *   insetX  = 0   (user messages are full-width)
 *   padY    = messageDef.padY (4 px each side)
 *
 * Does NOT call `virt.setSize` — the overlay is outside the virtualizer tree.
 * Measurement uses `cachedMeasure` with `isActiveTurn=false` so the WeakMap
 * cache hit from the real Row is reused; no re-computation overhead.
 *
 * An opaque `bg-chat-bg` backing covers the padY gaps so scrolling content
 * does not bleed through the top and bottom edges of the overlay.
 */

import type { RenderCtx } from '../core/define';
import type { ChatTheme } from '../core/theme';
import type { ChatMessage } from '../model';
import type { ChatCaches } from '../core/caches';
import { messageDef } from './message/message.def';
import { cachedMeasure } from './row-measure';

const PAD_Y = messageDef.padY ?? 0;

export function PinnedUserMessage(props: {
  item: ChatMessage;
  rowWidth: number;
  theme: ChatTheme;
  caches: ChatCaches;
}) {
  const measureCtx = () => ({
    theme: props.theme,
    // User rows have insetX = 0, so width = full rowWidth.
    width: props.rowWidth,
    isCollapsed: () => false,
    expanded: () => false,
    caches: props.caches,
  });

  // cache hit — Row already measured this committed item at the same fingerprint
  const layout = () => cachedMeasure(props.item, false, measureCtx());

  const renderCtx: RenderCtx = {
    viewState: { isCollapsed: () => false },
  };

  return (
    <div
      class="bg-chat-bg"
      style={{
        'padding-top': `${PAD_Y}px`,
        'padding-bottom': `${PAD_Y}px`,
      }}
    >
      <messageDef.Render item={props.item} layout={layout()} ctx={renderCtx} />
    </div>
  );
}
