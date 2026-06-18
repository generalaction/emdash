/**
 * Thinking — SolidJS component for ChatThinking rows.
 *
 * Both states are always collapsible/expandable via ThinkingHeader.
 *
 * Collapse semantics are inverted for thinking rows:
 *   stored false (default) → not expanded
 *     active: shows fixed-height preview window (ActivePreview) as real prose
 *     done:   shows header only
 *   stored true → expanded
 *     both: shows full prose body (ExpandedBody) laid out via pretext
 *
 * Both the preview and the expanded body render through the shared ThinkingProse
 * component, which uses the same BlockStack pipeline and foreground-passive color.
 *
 * The existing click-delegation in ChatRoot (data-collapse-id → toggleCollapsed)
 * drives the toggle without any ChatRoot or view-state changes.
 *
 * Geometry comes from ThemeContext (useTheme) instead of CSS vars.
 * All visual styling uses Tailwind utilities.
 */

import { Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { buildThinkingBlocks } from '../../core/blocks/parse-blocks';
import type { ChatThinking } from '../../model';
import { BlockStack } from '../rich-text/BlockStack';
import type { BlocksLayout } from '../rich-text/layout';
import { useTheme } from '../ThemeContext';

export type ThinkingProps = {
  item: ChatThinking;
  /** Stores "expanded" state — inverted from the conventional "collapsed" name. */
  collapsed?: boolean;
  /** Pre-computed pretext body layout (present only when expanded). */
  body?: BlocksLayout;
  /** Pre-computed pretext preview layout (present only when thinking + not expanded). */
  preview?: BlocksLayout;
};

function formatDurationS(ms: number): string {
  return String(Math.floor(ms / 1000));
}

// ── ThinkingHeader ─────────────────────────────────────────────────────────────

function ThinkingHeader(props: { item: ChatThinking; expanded: boolean; headerH: number }) {
  const startElapsed = Math.floor((Date.now() - props.item.startedAt) / 1000);
  const [elapsed, setElapsed] = createSignal(startElapsed);

  let timer: ReturnType<typeof setInterval> | undefined;

  createEffect(() => {
    if (props.item.status === 'thinking') {
      timer = setInterval(() => {
        setElapsed(Math.floor((Date.now() - props.item.startedAt) / 1000));
      }, 1000);
    } else {
      clearInterval(timer);
      timer = undefined;
    }
  });
  onCleanup(() => clearInterval(timer));

  const label = () => {
    if (props.item.status === 'thinking') return `Thinking ${elapsed()}s`;
    if (props.item.durationMs !== undefined)
      return `Thought for ${formatDurationS(props.item.durationMs)}s`;
    return 'Thought';
  };

  return (
    <div
      class="flex cursor-pointer items-center gap-1.5 text-sm text-foreground-passive select-none hover:text-foreground-muted"
      style={{ height: `${props.headerH}px` }}
      role="button"
      aria-expanded={props.expanded ? 'true' : 'false'}
      aria-live={props.item.status === 'thinking' ? 'polite' : undefined}
      aria-atomic={props.item.status === 'thinking' ? 'false' : undefined}
      data-collapse-id={props.item.id}
    >
      <span classList={{ 'text-shimmer': props.item.status === 'thinking' }}>{label()}</span>
      <span
        class="inline-block text-[10px] transition-transform duration-150 ease-out"
        classList={{ 'rotate-90': props.expanded }}
        aria-hidden="true"
      >
        ›
      </span>
    </div>
  );
}

// ── ThinkingProse ──────────────────────────────────────────────────────────────

function ThinkingProse(props: { item: ChatThinking; layout: BlocksLayout }) {
  const blocks = () => buildThinkingBlocks(props.item.id, props.item.text);
  return <BlockStack blocks={blocks()} laid={props.layout.blocks} />;
}

// ── ActivePreview ──────────────────────────────────────────────────────────────

function ActivePreview(props: {
  item: ChatThinking;
  preview: BlocksLayout;
  windowH: number;
  fadeH: number;
}) {
  let scrollEl: HTMLDivElement | undefined;

  createEffect(() => {
    if (props.item.text != null && scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  });

  return (
    <div class="relative overflow-hidden" style={{ height: `${props.windowH}px` }}>
      <div
        class="fade-overlay-top pointer-events-none absolute inset-x-0 top-0 z-10"
        style={{ height: `${props.fadeH}px` }}
        aria-hidden="true"
      />
      <div
        ref={(el) => {
          scrollEl = el;
        }}
        class="overflow-y-auto text-foreground-passive"
        style={{ 'max-height': `${props.windowH}px`, 'scrollbar-gutter': 'stable' }}
      >
        <div style={{ position: 'relative', height: `${props.preview.height}px` }}>
          <ThinkingProse item={props.item} layout={props.preview} />
        </div>
      </div>
    </div>
  );
}

// ── ExpandedBody ───────────────────────────────────────────────────────────────

function ExpandedBody(props: { item: ChatThinking; body: BlocksLayout }) {
  return (
    <div
      class="text-foreground-passive"
      style={{
        height: `${props.body.height}px`,
        left: '0',
        right: '0',
        position: 'absolute',
      }}
    >
      <ThinkingProse item={props.item} layout={props.body} />
    </div>
  );
}

// ── ThinkingContent ────────────────────────────────────────────────────────────

function ThinkingContent(props: {
  item: ChatThinking;
  expanded: boolean;
  body?: BlocksLayout;
  preview?: BlocksLayout;
  windowH: number;
  fadeH: number;
  headerH: number;
}) {
  return (
    <Show
      when={props.expanded && props.body}
      fallback={
        <Show when={props.item.status === 'thinking' && props.preview}>
          {(preview) => (
            <div
              style={{
                position: 'absolute',
                top: `${props.headerH}px`,
                left: '0',
                right: '0',
              }}
            >
              <ActivePreview
                item={props.item}
                preview={preview()}
                windowH={props.windowH}
                fadeH={props.fadeH}
              />
            </div>
          )}
        </Show>
      }
    >
      {(body) => <ExpandedBody item={props.item} body={body()} />}
    </Show>
  );
}

// ── Thinking ───────────────────────────────────────────────────────────────────

const THINKING_WINDOW_H = 72;
const THINKING_FADE_H = 28;

export function Thinking(props: ThinkingProps) {
  const theme = useTheme();
  const headerH = () => theme().fonts.body.lineHeight + 8;

  // Inverted semantics: stored "collapsed" flag is treated as "expanded".
  const expanded = () => !!props.collapsed;

  const totalH = () => {
    if (props.body) return headerH() + props.body.height;
    if (props.item.status === 'thinking') return headerH() + THINKING_WINDOW_H;
    return headerH();
  };

  return (
    <div
      style={{
        position: 'relative',
        height: `${totalH()}px`,
      }}
    >
      <ThinkingHeader item={props.item} expanded={expanded()} headerH={headerH()} />
      <ThinkingContent
        item={props.item}
        expanded={expanded()}
        body={props.body}
        preview={props.preview}
        windowH={THINKING_WINDOW_H}
        fadeH={THINKING_FADE_H}
        headerH={headerH()}
      />
    </div>
  );
}
