/**
 * ComboboxPopover
 *
 * A fully styled searchable combobox-in-popover, generic over any item type.
 * Composes the base-ui Combobox wrappers (trigger, in-popover search, scrollable
 * list) with optional per-row detail hover cards via the `HoverCard` primitive.
 *
 * Features:
 *  - In-popover `ComboboxInput` for incremental search.
 *  - Generic render slots: `renderTrigger(selected | null)`, `renderItem(item)`.
 *  - Optional `renderItemDetail(item)`: if provided a `HoverCard` is anchored to
 *    the popup panel and opens on row hover with OPEN_DELAY timing.
 *  - Non-closing interactivity: interactions inside the hover card or nested
 *    portals cancel Combobox dismissal via `eventDetails.cancel()`.
 *  - `detailSide`/`detailAlign` control the hover-card placement.
 */

import { type ComboboxRootChangeEventDetails } from '@base-ui/react/combobox';
import { ChevronDown } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '../primitives/combobox';
import { HoverCard, isEventInsideInteractiveLayer, useHoverCard } from '../primitives/hover-card';
import * as styles from './combobox-popover.css';

// ── Public types ──────────────────────────────────────────────────────────────

export interface ComboboxPopoverProps<T> {
  items: T[];
  value: string | null | undefined;
  onValueChange: (value: string) => void;
  /** Extract a stable unique key from an item. */
  itemToKey: (item: T) => string;
  /** Extract the primary display label from an item. */
  itemToLabel: (item: T) => string;
  /**
   * Custom filter predicate. Defaults to a case-insensitive label substring
   * match so items with no matching substring are hidden.
   */
  filter?: (item: T, query: string) => boolean;
  /**
   * Render the trigger button content.
   * Receives the currently selected item (or `null` when nothing is selected).
   */
  renderTrigger: (selected: T | null) => React.ReactNode;
  /**
   * Render the content of each list row.
   * Receives the item; the row wrapper (hover/selected states) is provided by
   * the primitive.
   */
  renderItem: (item: T) => React.ReactNode;
  /**
   * When provided a detail hover card is shown beside the list on row hover.
   * Receives the currently hovered item.
   */
  renderItemDetail?: (item: T) => React.ReactNode;
  /** Placeholder text inside the search input. */
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  contentStyle?: React.CSSProperties;
  /** Side for the detail hover card relative to the list popup. Defaults to 'right'. */
  detailSide?: 'top' | 'bottom' | 'left' | 'right';
  /** Align for the detail hover card. Defaults to 'start'. */
  detailAlign?: 'start' | 'center' | 'end';
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ComboboxPopover<T>({
  items,
  value,
  onValueChange,
  itemToKey,
  itemToLabel,
  filter,
  renderTrigger,
  renderItem,
  renderItemDetail,
  searchPlaceholder = 'Search…',
  disabled = false,
  className,
  contentClassName,
  contentStyle,
  detailSide = 'right',
  detailAlign = 'start',
}: ComboboxPopoverProps<T>) {
  const [open, setOpen] = React.useState(false);
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const hoverCard = useHoverCard();

  const selectedItem = value != null ? (items.find((i) => itemToKey(i) === value) ?? null) : null;

  const activeDetailItem =
    renderItemDetail && hoverCard.activeKey != null
      ? (items.find((i) => itemToKey(i) === hoverCard.activeKey) ?? null)
      : null;

  const defaultFilter = React.useCallback(
    (item: T, query: string) => itemToLabel(item).toLowerCase().includes(query.toLowerCase()),
    [itemToLabel]
  );

  function handleOpenChange(next: boolean, eventDetails: ComboboxRootChangeEventDetails) {
    if (disabled) return;
    // Interactions inside the hover card (or nested portals opened from it) must
    // not close the combobox list — cancel the dismissal.
    if (!next && hoverCard.open && isEventInsideInteractiveLayer(eventDetails.event, anchorEl)) {
      eventDetails.cancel();
      return;
    }
    if (!next) hoverCard.close();
    setOpen(next);
  }

  function handleValueChange(item: T | null) {
    if (!item || disabled) return;
    hoverCard.close();
    onValueChange(itemToKey(item));
    setOpen(false);
  }

  return (
    <Combobox
      value={selectedItem ?? null}
      onValueChange={handleValueChange}
      open={open}
      onOpenChange={disabled ? undefined : handleOpenChange}
      isItemEqualToValue={(a: T, b: T) => itemToKey(a) === itemToKey(b)}
      filter={filter ?? defaultFilter}
      autoHighlight
    >
      <ComboboxTrigger disabled={disabled} className={cn(styles.trigger, className)}>
        <span className={styles.triggerLabel}>{renderTrigger(selectedItem)}</span>
        <ChevronDown className={styles.triggerChevron} />
      </ComboboxTrigger>

      <ComboboxContent
        ref={setAnchorEl}
        className={cn(styles.contentMinWidth, contentClassName)}
        style={contentStyle}
      >
        <ComboboxInput showTrigger={false} placeholder={searchPlaceholder} />
        <ComboboxList>
          {items.map((item) => {
            const key = itemToKey(item);
            return (
              <ComboboxItem
                key={key}
                value={item}
                {...(renderItemDetail ? hoverCard.getRowHoverProps(key) : {})}
              >
                {renderItem(item)}
              </ComboboxItem>
            );
          })}
        </ComboboxList>
      </ComboboxContent>

      {renderItemDetail && activeDetailItem && (
        <HoverCard
          anchor={anchorEl}
          ownPopup={anchorEl ?? undefined}
          controller={hoverCard}
          side={detailSide}
          align={detailAlign}
        >
          {renderItemDetail(activeDetailItem)}
        </HoverCard>
      )}
    </Combobox>
  );
}
