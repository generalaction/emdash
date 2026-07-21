/**
 * Marks the DOM container of a task focus region ('main' panes vs 'bottom'
 * terminal drawer). Set on the region roots in task-main-column.tsx and read
 * by {@link shouldSkipAutofocus}.
 */
export const TASK_FOCUS_REGION_ATTR = 'data-task-focus-region';

const TYPING_SURFACE_SELECTOR = 'input, textarea, select, [contenteditable="true"]';

/**
 * True when an autofocus effect should skip focusing because the user is
 * already in a typing surface (input, textarea, contenteditable — e.g. Monaco,
 * xterm, the chat composer) in the same task region, outside `ownContainer`.
 *
 * `focusedRegion` is tracked passively — focusing anything inside a region
 * claims it, which is what keeps the region restored on task re-entry
 * accurate. The cost is that region-gated autofocus effects also re-fire when
 * the user merely focuses another element, and answering that would steal
 * focus from the element they just chose. This check tells the cases apart at
 * fire time. Non-typing controls (tab buttons, sidebar rows) are deliberately
 * not protected: clicking them is how users hand focus to a pane's content. A
 * typing surface in the other region doesn't block either: cross-region
 * transitions (task re-entry, closing the drawer) are exactly when focus must
 * move between regions.
 *
 * Pass the caller's own container so focus already inside it never suppresses
 * the autofocus; pass null when even refocusing self would be destructive
 * (e.g. a URL input whose autofocus also select-alls).
 */
export function shouldSkipAutofocus(ownContainer: Element | null): boolean {
  const active = document.activeElement;
  if (!active || active === document.body) return false;
  // A hidden element can linger as activeElement (e.g. a view hidden instead of
  // unmounted); it is not a place the user can type, so it never blocks.
  // Feature-detected because jsdom lacks checkVisibility.
  if (typeof active.checkVisibility === 'function' && !active.checkVisibility()) return false;
  if (ownContainer?.contains(active)) return false;
  if (!active.matches(TYPING_SURFACE_SELECTOR)) return false;
  const activeRegion = active.closest(`[${TASK_FOCUS_REGION_ATTR}]`);
  if (!activeRegion) return false;
  return ownContainer ? activeRegion.contains(ownContainer) : true;
}
