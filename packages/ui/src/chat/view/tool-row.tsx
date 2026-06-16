import { observer } from 'mobx-react-lite';
import React from 'react';
import type { BlockId } from '../blocks/block-types';
import type { ChatToolCall } from '../model';
import type { ViewStateStore } from '../state/view-state-store';

const STATUS_ICON: Record<string, string> = {
  running: '⋯',
  done: '✓',
  error: '✕',
};

type ToolRowProps = {
  item: ChatToolCall;
  viewState: ViewStateStore;
};

/**
 * ToolRow — renders a single tool-call item.
 *
 * Shows name + inputSummary.  When there is a `detail` string, it can be
 * expanded/collapsed.  The collapse state is stored in ViewStateStore using
 * the tool item's id as the block ID (tool items are not further subdivided).
 */
export const ToolRow = observer(function ToolRow({
  item,
  viewState,
}: ToolRowProps): React.ReactElement {
  const blockId: BlockId = item.id;
  const collapsed = viewState.isCollapsed(blockId);
  const hasDetail = Boolean(item.detail);

  return (
    <div className="chat-tool">
      <span
        className={`chat-tool__badge chat-tool__badge--${item.status}`}
        aria-label={item.status}
      >
        {STATUS_ICON[item.status] ?? '?'}
      </span>

      <span className="chat-tool__name">{item.name}</span>

      {item.inputSummary && <span className="chat-tool__summary">{item.inputSummary}</span>}

      {hasDetail && (
        <button
          type="button"
          className="chat-collapse-toggle"
          aria-expanded={!collapsed}
          onClick={() => viewState.toggleCollapsed(blockId)}
        >
          {collapsed ? '▸ detail' : '▾ hide'}
        </button>
      )}

      {hasDetail && !collapsed && (
        <div className="chat-tool__detail">
          <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap' }}>{item.detail}</pre>
        </div>
      )}
    </div>
  );
});
