import { observer } from 'mobx-react-lite';
import React, { useMemo } from 'react';
import { specForBlock } from '../blocks/block-spec';
import { parseBlocksCached } from '../blocks/parse-blocks';
import type { HeightModel } from '../measure/height-model';
import type { ChatMessage } from '../model';
import type { ViewStateStore } from '../state/view-state-store';
import type { ChatSlots } from './chat-transcript';

type MessageRowProps = {
  item: ChatMessage;
  viewState: ViewStateStore;
  heightModel: HeightModel;
  slots?: ChatSlots;
  /** Called whenever the row's measured height may have changed (e.g. island resize). */
  onHeightChange?: () => void;
  /** When true, code and island blocks render cheap placeholders instead of full DOM. */
  isScrolling?: boolean;
};

/**
 * MessageRow — renders a single chat message.
 *
 * Dispatches each block to `specForBlock(block).render(...)`, so measure and
 * render are guaranteed to use the same chrome accounting.
 */
export const MessageRow = observer(function MessageRow({
  item,
  viewState,
  heightModel,
  slots,
  onHeightChange,
  isScrolling,
}: MessageRowProps): React.ReactElement {
  const blocks = useMemo(() => parseBlocksCached(item.id, item.text), [item.id, item.text]);

  const isUser = item.role === 'user';
  const isThought = item.role === 'thought';

  const bubbleClass = [
    'chat-bubble',
    isUser ? 'chat-bubble--user' : isThought ? 'chat-bubble--thought' : 'chat-bubble--assistant',
  ].join(' ');

  const messageClass = [
    'chat-message',
    isUser ? 'chat-message--user' : isThought ? 'chat-message--thought' : 'chat-message--assistant',
  ].join(' ');

  return (
    <div className={messageClass}>
      <div className={bubbleClass}>
        {blocks.map((block) => {
          const collapsed = viewState.isCollapsed(block.id);
          return (
            <React.Fragment key={block.id}>
              {specForBlock(block).render(block, {
                slots,
                collapsed,
                isScrolling,
                onMeasured: (blockId, height) => {
                  // Only notify the virtualizer when the height genuinely changed;
                  // otherwise a stable measurement would re-trigger measure() →
                  // re-render → ref → measure() indefinitely.
                  if (heightModel.setMeasured(blockId, height)) {
                    onHeightChange?.();
                  }
                },
              })}
            </React.Fragment>
          );
        })}

        {item.streaming && <span className="chat-cursor" aria-hidden="true" />}
      </div>
    </div>
  );
});
