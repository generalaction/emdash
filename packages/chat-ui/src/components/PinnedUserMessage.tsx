/**
 * PinnedUserMessage — a non-virtualized copy of a user message row, rendered
 * as the pinned-header overlay in ChatRoot when `pinUserMessages` is enabled.
 *
 * Mirrors Row.tsx geometry for user-role messages:
 *   insetX  = 0   (user messages are full-width)
 *
 * Rendered as an opaque `bg-chat-bg` container with a ROW_GAP top padding: the
 * padding gives the message its 8px gap to the viewport top while the filled
 * strip (and the backing behind the message) hides the rows scrolling behind it.
 *
 * Does NOT call `virt.setSize` — the overlay is outside the virtualizer tree.
 * Measurement uses `cachedMeasure` with `isActiveTurn=false` so the WeakMap
 * cache hit from the real Row is reused; no re-computation overhead.
 */

import type { RenderCtx } from '../core/define';
import type { ChatTheme } from '../core/theme';
import type { ChatMessage } from '../model';
import type { ChatCaches } from '../core/caches';
import { ROW_GAP } from '../core/metrics';
import { messageDef } from './message/message.def';
import { cachedMeasure } from './row-measure';

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
    <div class="bg-chat-bg/80 backdrop-blur-sm" style={{ 'padding-top': `${ROW_GAP}px` }}>
      <messageDef.Render item={props.item} layout={layout()} ctx={renderCtx} />
    </div>
  );
}
