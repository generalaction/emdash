/**
 * Row — dispatches by item.kind and owns the virtualizer height bridge.
 *
 * For each visible slot:
 *   1. createMemo computes the layout/height (depends on item content + width + collapse state)
 *   2. createEffect writes the height into the Fenwick virtualizer
 *   3. The appropriate component renders the content
 *
 * Rendered via <For> keyed by row index, so each Row instance owns a fixed row
 * index for its lifetime — no slot recycling, no cross-row measured-height
 * contamination.
 */

import { Match, Switch, createEffect, createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';
import { DEFAULT_FONT_CONFIG } from '../core/measure/fonts';
import type { FontConfig } from '../core/measure/fonts';
import { ROW_GAP } from '../core/metrics';
import type { Virtualizer } from '../core/virtualizer';
import type { ChatItem, ChatMessage, ChatThinking, ChatToolCall } from '../model';
import type { ViewState } from '../state/view-state';
import { measureMessage } from './message/measure';
import { Message } from './message/Message';
import { measureThinking } from './thinking/measure';
import { Thinking } from './thinking/Thinking';
import { measureTool } from './tool/measure';
import { Tool } from './tool/Tool';

export type RowProps = {
  item: ChatItem;
  index: number;
  rowWidth: number;
  fonts?: FontConfig;
  viewState: ViewState;
  virt: Virtualizer;
  onHeightChanged: (index: number, delta: number) => void;
};

export function Row(props: RowProps) {
  const fonts = () => props.fonts ?? DEFAULT_FONT_CONFIG;

  // DOM-measured heights for islands and thinking bodies, written back by the
  // child components. Scoped to this Row, which owns a single row index.
  const [measured, setMeasured] = createStore<Record<string, number>>({});

  // ── Layout memo ─────────────────────────────────────────────────────────────

  const rowHeight = createMemo(() => {
    const item = props.item;
    const isCollapsed = (id: string) => props.viewState.isCollapsed(id);
    const getMeasured = (id: string) => measured[id];

    if (item.kind === 'message') {
      const layout = measureMessage(
        item as ChatMessage,
        props.rowWidth,
        fonts(),
        isCollapsed,
        getMeasured
      );
      return layout.height;
    }
    if (item.kind === 'tool') {
      return measureTool(item as ChatToolCall, isCollapsed);
    }
    if (item.kind === 'thinking') {
      return measureThinking(
        item as ChatThinking,
        isCollapsed,
        measured[(item as ChatThinking).id]
      );
    }
    return 60 + ROW_GAP;
  });

  // ── Message layout (kept separate for passing to Message component) ─────────

  const messageLayout = createMemo(() => {
    const item = props.item;
    if (item.kind !== 'message') return null;
    const isCollapsed = (id: string) => props.viewState.isCollapsed(id);
    const getMeasured = (id: string) => measured[id];
    return measureMessage(item as ChatMessage, props.rowWidth, fonts(), isCollapsed, getMeasured);
  });

  // ── Height bridge effect ────────────────────────────────────────────────────

  createEffect(() => {
    const h = rowHeight();
    const delta = props.virt.setSize(props.index, h);
    if (delta !== 0) props.onHeightChanged(props.index, delta);
  });

  // ── Callbacks ───────────────────────────────────────────────────────────────

  const onIslandMeasured = (blockId: string, h: number) => {
    setMeasured(blockId, h);
  };

  const onBodyMeasured = (id: string, h: number) => {
    setMeasured(id, h);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  //
  // Dispatch by kind with <Switch>/<Match>. Unlike `{cond && <Comp/>}`, Switch
  // keeps the active branch mounted while the matched kind is unchanged — so a
  // slot recycling message→message just feeds new props to the existing Message
  // (no DOM recreation, no flicker). It only swaps the subtree when the row's
  // kind actually changes.

  const kind = createMemo(() => props.item.kind);

  return (
    <Switch>
      <Match when={kind() === 'message'}>
        <Message
          item={props.item as ChatMessage}
          layout={messageLayout()!}
          onIslandMeasured={onIslandMeasured}
        />
      </Match>
      <Match when={kind() === 'tool'}>
        <Tool
          item={props.item as ChatToolCall}
          collapsed={props.viewState.isCollapsed((props.item as ChatToolCall).id)}
        />
      </Match>
      <Match when={kind() === 'thinking'}>
        <Thinking
          item={props.item as ChatThinking}
          collapsed={props.viewState.isCollapsed((props.item as ChatThinking).id)}
          onBodyMeasured={onBodyMeasured}
          bodyMeasuredHeight={measured[(props.item as ChatThinking).id]}
        />
      </Match>
    </Switch>
  );
}
