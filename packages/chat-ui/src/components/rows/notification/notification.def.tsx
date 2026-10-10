import { BlockStackView } from '@components/primitives/BlockStackView';
import { layoutBlockStack } from '@core/layout/block-stack';
import type { Block, InlineRun } from '@core/markdown/document';
import { defineUnit } from '@core/units';
import { Show, createMemo } from 'solid-js';
import type { TranscriptItem } from '@/model';
import { srOnly } from '@components/rows/message/message.css';
import { vars } from '@styles/theme.css';

type Notification = Extract<TranscriptItem, { kind: 'notification' }>;

// Build literal prose directly: provider event text must not create links,
// mentions, HTML elements, or Markdown controls. Layout and paint share it.
function blocks(item: Notification): Block[] {
  return [item.title, item.text].filter(Boolean).map((text, index) => ({
    kind: 'prose',
    id: `${item.id}#${index}`,
    variant: 'body',
    runs: text
      .split('\n')
      .flatMap((line, lineIndex): InlineRun[] => [
        ...(lineIndex ? [{ kind: 'break' as const }] : []),
        { kind: 'text', text: line, bold: index === 0 },
      ]),
  }));
}

export const notificationUnitDef = defineUnit<Notification, Record<string, never>>({
  kind: 'notification',
  margin: { top: 8, bottom: 8 },
  vars: {},
  measure(item, ctx) {
    return layoutBlockStack(blocks(item), ctx, { isCollapsed: ctx.isCollapsed }).height;
  },
  Render(props) {
    const stack = createMemo(() => {
      const ctx = props.ctx.measureCtx?.();
      return ctx
        ? layoutBlockStack(blocks(props.data), ctx, { isCollapsed: ctx.isCollapsed })
        : null;
    });
    return (
      <div
        data-notification
        role="note"
        aria-label="Background notification"
        style={{ color: vars.fgMuted }}
      >
        <div class={srOnly}>{[props.data.title, props.data.text].filter(Boolean).join('\n\n')}</div>
        <Show when={stack()}>{(node) => <BlockStackView node={node()} />}</Show>
      </div>
    );
  },
});
