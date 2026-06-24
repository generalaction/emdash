/**
 * CollapseHeader — shared collapsible-row header primitive.
 *
 * Renders a `role="button"` container with:
 *   - `data-collapse-id` for the ChatRoot click-delegation handler
 *   - `aria-expanded` reflecting the current expanded state
 *   - `text-shimmer` class while the row is active/running
 *   - a rotating `›` chevron (90° when expanded)
 *
 * The `children` slot holds the row label content (text, badge, etc.).
 *
 * Used by ThinkingHeader and FileOpHeader so the chevron/shimmer/a11y
 * attributes are not duplicated across components.
 */

import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { chevron, chevronExpanded, collapseHeader } from './collapse-header.css';
import { IconError } from './icons';
import { textShimmer } from '@styles/effects.css';
import { vars } from '@styles/theme.css';

export type CollapseHeaderProps = {
  /** The item id wired to data-collapse-id for ChatRoot delegation. */
  id: string;
  /** Whether the section is currently expanded. */
  expanded: boolean;
  /**
   * When true, applies `text-shimmer` to the label (streaming / running state).
   */
  active?: boolean;
  /** When true, renders the error icon pinned to the far right. */
  error?: boolean;
  /** Explicit pixel height for the header row. */
  height: number;
  children: JSX.Element;
};

export function CollapseHeader(props: CollapseHeaderProps) {
  return (
    <div
      class={collapseHeader}
      style={{ height: `${props.height}px` }}
      role="button"
      aria-expanded={props.expanded ? 'true' : 'false'}
      data-collapse-id={props.id}
    >
      <span classList={{ [textShimmer]: !!props.active }}>{props.children}</span>
      <span class={chevron} classList={{ [chevronExpanded]: props.expanded }} aria-hidden="true">
        ›
      </span>
      <Show when={props.error}>
        <span
          style={{ 'margin-left': 'auto', display: 'flex', color: vars.fgError }}
          aria-label="error"
        >
          <IconError />
        </span>
      </Show>
    </div>
  );
}
