/**
 * CollapsibleCard — shared bordered collapsible-card primitive.
 *
 * Renders a bordered, rounded card with a sticky collapsible header and an
 * arbitrary body slot. Used by plan and execute rows.
 *
 * Key behaviour:
 *   - Resolves `ctx.clipHeight?.() ?? height` as the root element's height so
 *     the bottom border and rounded corners remain visible throughout the
 *     collapse/expand tween (they track the animated edge, not the full height).
 *   - Wires `data-collapse-id`, `aria-expanded`, shimmer, and chevron in one
 *     place so card rows do not re-implement them.
 */

import type { RenderCtx } from '@core/define';
import { pxTokens } from '@styles/px-tokens';
import { assignInlineVars } from '@vanilla-extract/dynamic';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { clipTrackedHeight } from './card-clip';
import { IconError } from './icons';
import {
  cardChevron,
  cardChevronExpanded,
  cardHeader,
  collapsibleCard,
  collapsibleCardVars,
} from './collapsible-card.css';
import { textShimmer } from '@styles/effects.css';
import { vars } from '@styles/theme.css';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CollapsibleCardProps = {
  /** Item id wired to data-collapse-id for ChatRoot click delegation. */
  id: string;
  /** RenderCtx from the parent def — read to obtain the animated clipHeight. */
  ctx: RenderCtx;
  /** Full measured card height (px) for the current display state. */
  height: number;
  /** Header row height in px (drives flex height). */
  headerH: number;
  /** Whether the card is currently expanded. */
  expanded: boolean;
  /**
   * When true, applies the text-shimmer animation to the header label
   * (use while the item is running / streaming).
   */
  active?: boolean;
  /** When true, renders the error icon on the far right of the header. */
  error?: boolean;
  /** Header label content (left side of the header). */
  header: JSX.Element;
  /** Optional right-aligned content beside the error icon. */
  headerRight?: JSX.Element;
  /** Card body — rendered below the header inside the clipped shell. */
  children: JSX.Element;
};

// ── Component ─────────────────────────────────────────────────────────────────

export function CollapsibleCard(props: CollapsibleCardProps) {
  // Single source of truth for the bottom-border fix: during a tween, prefer
  // the animated content height so the bordered shell tracks the moving edge.
  const cardH = clipTrackedHeight(props.ctx, () => props.height);

  return (
    <div
      class={collapsibleCard}
      style={assignInlineVars(collapsibleCardVars, pxTokens({ height: cardH() }))}
    >
      <div
        class={cardHeader}
        style={{ height: `${props.headerH}px` }}
        role="button"
        aria-expanded={props.expanded ? 'true' : 'false'}
        data-collapse-id={props.id}
      >
        <span style={{ display: 'flex', 'align-items': 'center', gap: '6px' }}>
          <span classList={{ [textShimmer]: !!props.active }}>{props.header}</span>
          <span
            class={cardChevron}
            classList={{ [cardChevronExpanded]: props.expanded }}
            aria-hidden="true"
          >
            ›
          </span>
        </span>
        <span style={{ display: 'flex', 'align-items': 'center', gap: '6px' }}>
          {props.headerRight}
          <Show when={props.error}>
            <span style={{ display: 'flex', color: vars.fgError }} aria-label="error">
              <IconError />
            </span>
          </Show>
        </span>
      </div>
      {props.children}
    </div>
  );
}
