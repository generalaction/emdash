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

export type CollapseHeaderProps = {
  /** The item id wired to data-collapse-id for ChatRoot delegation. */
  id: string;
  /** Whether the section is currently expanded. */
  expanded: boolean;
  /**
   * When true, applies `text-shimmer` to the label (streaming / running state).
   */
  active?: boolean;
  /** Explicit pixel height for the header row. */
  height: number;
  children: JSX.Element;
};

export function CollapseHeader(props: CollapseHeaderProps) {
  return (
    <div
      class="flex cursor-pointer items-center gap-1.5 text-sm text-foreground-passive select-none hover:text-foreground-muted"
      style={{ height: `${props.height}px` }}
      role="button"
      aria-expanded={props.expanded ? 'true' : 'false'}
      data-collapse-id={props.id}
    >
      <span classList={{ 'text-shimmer': !!props.active }}>{props.children}</span>
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
