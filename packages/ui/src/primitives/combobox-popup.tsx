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
 * surface-elevated, ring-1, shadow, rounded-md, text-sm items with bg-surface-hover
 * on highlight and text-foreground-muted descriptions.
 */

import { XIcon } from 'lucide-react';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';

// ── Public types ──────────────────────────────────────────────────────────────

export interface ComboboxPopupItem {
  id: string;
  /** Optional icon node rendered before the label (e.g. a devicon <i> or lucide svg). */
  icon?: React.ReactNode;
  /** Primary display text. */
  label: string;
  /** Secondary muted text shown on the right. */
  description?: string;
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
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const ComboboxPopup = React.forwardRef<ComboboxPopupHandle, ComboboxPopupProps>(
  function ComboboxPopup({ items, anchorRect, onSelect, emptyLabel, header, className }, ref) {
    const [selectedIndex, setSelectedIndex] = React.useState(0);
    const listRef = React.useRef<HTMLUListElement>(null);

    // Reset selection when the item list changes.
    React.useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    // Scroll the highlighted item into view.
    React.useEffect(() => {
      const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
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
        style={style}
        className={cn(
          'z-50 min-w-[220px] max-w-[340px] overflow-hidden rounded-md',
          'surface-elevated bg-surface text-foreground shadow-sm ring-1 ring-foreground/10',
          'animate-in fade-in-0 zoom-in-95 duration-100',
          className,
        )}
      >
        {header && <div className="border-b border-border px-2 py-1.5 text-xs text-foreground-muted">{header}</div>}
        <ul ref={listRef} className="max-h-[240px] scroll-py-1 overflow-y-auto p-1">
          {items.length === 0 && emptyLabel ? (
            <li className="px-2 py-1.5 text-center text-sm text-foreground-muted">{emptyLabel}</li>
          ) : (
            items.map((item, index) => (
              <li
                key={item.id}
                role="option"
                aria-selected={index === selectedIndex}
                onMouseDown={(e) => {
                  // Prevent editor blur before select fires.
                  e.preventDefault();
                  onSelect(item);
                }}
                onMouseEnter={() => setSelectedIndex(index)}
                className={cn(
                  'relative flex w-full cursor-default select-none items-center gap-2',
                  'rounded-sm py-1.5 pl-2 pr-8 text-sm outline-hidden',
                  index === selectedIndex
                    ? 'bg-surface-hover text-foreground'
                    : 'text-foreground hover:bg-surface-hover',
                )}
              >
                {item.icon && (
                  <span className="flex shrink-0 items-center text-[1em] [&_svg]:size-4">
                    {item.icon}
                  </span>
                )}
                <span className="flex-1 truncate">{item.label}</span>
                {item.description && (
                  <span className="truncate text-xs text-foreground-muted">{item.description}</span>
                )}
              </li>
            ))
          )}
        </ul>
      </div>
    );

    return createPortal(popup, document.body);
  },
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
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-sm opacity-50 hover:opacity-100',
        className,
      )}
      aria-label="Dismiss"
    >
      <XIcon className="size-3" />
    </button>
  );
}
