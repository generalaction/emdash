/**
 * ComboboxPopup
 *
 * A reusable floating listbox anchored to a caret position (or any DOMRect).
 * Designed for TipTap suggestion menus but usable wherever a lightweight
 * anchor-positioned popup list is needed.
 *
 * Keyboard navigation is externally driven: the host TipTap extension forwards
 * key events to the imperative `onKeyDown` handle. ArrowUp / ArrowDown move the
 * highlight, Enter / Tab confirm, Escape returns false so the caller can dismiss.
 *
 * Visual language mirrors ComboboxContent / ComboboxItem from combobox.tsx:
 * elevated Surface, ring, shadow, rounded rows, and Surface-relative hover
 * on highlight and text-foreground-muted descriptions.
 */

import { cx } from '@styles/index';
import { XIcon } from 'lucide-react';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { menuItem } from '../../../styles/recipes/menu-item';
import { Icon, IconSlot } from '../icon';
import * as styles from './combobox-popup.css';

// ── Public types ──────────────────────────────────────────────────────────────

export interface ComboboxPopupItem {
  id: string;
  /** Decorative caller-owned content rendered before the label in an icon slot. */
  icon?: React.ReactNode;
  /** Primary display text. */
  label: string;
  /** Secondary muted text shown on the right. */
  description?: string;
  /** Optional visual grouping label rendered as a non-selectable header. */
  section?: string;
}

export interface ComboboxPopupHandle {
  onKeyDown(event: KeyboardEvent): boolean;
}

interface ComboboxPopupProps {
  items: ComboboxPopupItem[];
  /** Caret-position anchor. Popup renders nothing when null or empty. */
  anchorRect: DOMRect | null;
  onSelect(item: ComboboxPopupItem): void;
  /** Text shown when items is empty but anchorRect is set. Omit to hide popup when empty. */
  emptyLabel?: string;
  /** Optional header node rendered above the item list. */
  header?: React.ReactNode;
  /** Render label and description as two stacked rows instead of a single row. */
  stacked?: boolean;
  /** Applies caller-owned classes to the rendered listbox popup root. */
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const ComboboxPopup = React.forwardRef<ComboboxPopupHandle, ComboboxPopupProps>(
  function ComboboxPopup(
    { items, anchorRect, onSelect, emptyLabel, header, stacked = false, className },
    ref
  ) {
    const [selectedIndex, setSelectedIndex] = React.useState(0);
    const listRef = React.useRef<HTMLUListElement>(null);

    // Reset selection when the item list changes.
    React.useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    // Scroll the highlighted item into view.
    React.useEffect(() => {
      const el = listRef.current?.querySelector<HTMLElement>(
        `[data-popup-item-index="${selectedIndex}"]`
      );
      el?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    React.useImperativeHandle(ref, () => ({
      onKeyDown(event: KeyboardEvent): boolean {
        if (event.key === 'ArrowDown') {
          setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
          return true;
        }
        if (event.key === 'ArrowUp') {
          setSelectedIndex((i) => Math.max(i - 1, 0));
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const item = items[selectedIndex];
          if (item) onSelect(item);
          return true;
        }
        if (event.key === 'Escape') {
          return false;
        }
        return false;
      },
    }));

    // Nothing to render.
    if (!anchorRect) return null;
    if (items.length === 0 && !emptyLabel) return null;

    // Position above or below the caret depending on available space.
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const spaceAbove = anchorRect.top;
    const openAbove = spaceBelow < 200 && spaceAbove > spaceBelow;

    const style: React.CSSProperties = openAbove
      ? {
          position: 'fixed',
          left: anchorRect.left,
          bottom: window.innerHeight - anchorRect.top + 4,
        }
      : {
          position: 'fixed',
          left: anchorRect.left,
          top: anchorRect.bottom + 4,
        };

    const popup = (
      <div
        role="listbox"
        data-slot="combobox-popup"
        style={style}
        className={cx(styles.popupRoot, className)}
      >
        {header && (
          <div data-slot="combobox-popup-header" className={styles.popupHeader}>
            {header}
          </div>
        )}
        <ul ref={listRef} data-slot="combobox-popup-list" className={styles.popupList}>
          {items.length === 0 && emptyLabel ? (
            <li data-slot="combobox-popup-empty" className={styles.popupEmpty}>
              {emptyLabel}
            </li>
          ) : (
            items.map((item, index) => {
              const showSection = item.section && item.section !== items[index - 1]?.section;
              return (
                <React.Fragment key={item.id}>
                  {showSection && (
                    <li
                      data-slot="combobox-popup-section"
                      className={styles.popupSectionHeader}
                      role="presentation"
                    >
                      {item.section}
                    </li>
                  )}
                  <li
                    role="option"
                    data-slot="combobox-popup-item"
                    aria-selected={index === selectedIndex}
                    data-selected={index === selectedIndex || undefined}
                    data-popup-item-index={index}
                    onMouseDown={(e) => {
                      // Prevent editor blur before select fires.
                      e.preventDefault();
                      onSelect(item);
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cx(
                      menuItem({ fullWidth: true, trailingIndicator: !stacked }),
                      stacked && styles.popupItemStacked
                    )}
                  >
                    {item.icon && (
                      <IconSlot className={styles.popupItemIcon} size="sm">
                        {item.icon}
                      </IconSlot>
                    )}
                    {stacked ? (
                      <span
                        data-slot="combobox-popup-item-text"
                        className={styles.popupItemTextStack}
                      >
                        <span
                          data-slot="combobox-popup-item-label"
                          className={styles.popupItemLabel}
                        >
                          {item.label}
                        </span>
                        {item.description && (
                          <span
                            data-slot="combobox-popup-item-description"
                            className={styles.popupItemDescription}
                          >
                            {item.description}
                          </span>
                        )}
                      </span>
                    ) : (
                      <>
                        <span
                          data-slot="combobox-popup-item-label"
                          className={styles.popupItemLabel}
                        >
                          {item.label}
                        </span>
                        {item.description && (
                          <span
                            data-slot="combobox-popup-item-description"
                            className={styles.popupItemDescription}
                          >
                            {item.description}
                          </span>
                        )}
                      </>
                    )}
                  </li>
                </React.Fragment>
              );
            })
          )}
        </ul>
      </div>
    );

    return createPortal(popup, document.body);
  }
);

// ── Helper: dismiss button ────────────────────────────────────────────────────

/** Small icon-only dismiss button used inside ComboboxPopup headers. */
export function ComboboxPopupDismiss({
  onClick,
  className,
}: {
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        onClick?.();
      }}
      className={cx(styles.popupDismiss, className)}
      aria-label="Dismiss"
      data-slot="combobox-popup-dismiss"
    >
      <Icon source={XIcon} size="xs" />
    </button>
  );
}
