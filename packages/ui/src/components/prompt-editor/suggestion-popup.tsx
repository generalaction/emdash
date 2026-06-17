/**
 * SuggestionPopup
 *
 * A floating popup rendered by the TipTap suggestion plugin's `render` hook.
 * It is positioned relative to the caret using a virtual anchor derived from
 * the suggestion's `clientRect`. Keyboard navigation is forwarded through the
 * `onKeyDown` contract the suggestion plugin requires.
 *
 * Visually mirrors the existing Combobox family (bg-background-quaternary,
 * ring, shadow) for consistency with AgentSelector / AddContextPopover.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import type { MentionItem, CommandItem } from './types';

export type SuggestionItem = MentionItem | CommandItem;

function isMentionItem(item: SuggestionItem): item is MentionItem {
  return 'label' in item;
}

function getDisplayLabel(item: SuggestionItem): string {
  return isMentionItem(item) ? item.label : (item.label ?? item.name);
}

function getDisplayDescription(item: SuggestionItem): string | undefined {
  return item.description;
}

export interface SuggestionPopupHandle {
  onKeyDown(event: KeyboardEvent): boolean;
}

interface SuggestionPopupProps {
  items: SuggestionItem[];
  onSelect: (item: SuggestionItem) => void;
  // Position anchor
  rect: DOMRect | null;
}

export const SuggestionPopup = forwardRef<SuggestionPopupHandle, SuggestionPopupProps>(
  function SuggestionPopup({ items, onSelect, rect }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLUListElement>(null);

    // Reset selection whenever the item list changes.
    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    // Scroll the highlighted item into view.
    useEffect(() => {
      const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
      el?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    useImperativeHandle(ref, () => ({
      onKeyDown(event: KeyboardEvent): boolean {
        if (event.key === 'ArrowDown') {
          setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
          return true;
        }
        if (event.key === 'ArrowUp') {
          setSelectedIndex((i) => Math.max(i - 1, 0));
          return true;
        }
        if (event.key === 'Enter') {
          const item = items[selectedIndex];
          if (item) onSelect(item);
          return true;
        }
        if (event.key === 'Escape') {
          return false; // Let the editor handle dismiss.
        }
        return false;
      },
    }));

    if (!rect || items.length === 0) return null;

    // Position the popup above or below the caret.
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow;

    const style: React.CSSProperties = openAbove
      ? {
          position: 'fixed',
          left: rect.left,
          bottom: window.innerHeight - rect.top + 4,
        }
      : {
          position: 'fixed',
          left: rect.left,
          top: rect.bottom + 4,
        };

    return (
      <div
        role="listbox"
        style={style}
        className={cn(
          'z-50 min-w-[220px] max-w-[340px] overflow-hidden rounded-md',
          'bg-background-quaternary text-foreground shadow-sm ring-1 ring-foreground/10',
          'animate-in fade-in-0 zoom-in-95'
        )}
      >
        <ul ref={listRef} className="max-h-[240px] scroll-py-1 overflow-y-auto p-1">
          {items.map((item, index) => (
            <li
              key={item.id}
              role="option"
              aria-selected={index === selectedIndex}
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent editor blur.
                onSelect(item);
              }}
              onMouseEnter={() => setSelectedIndex(index)}
              className={cn(
                'relative flex w-full cursor-default select-none items-center gap-2',
                'rounded-sm py-1.5 pl-2 pr-8 text-sm outline-hidden',
                index === selectedIndex
                  ? 'bg-background-quaternary-1 text-foreground'
                  : 'text-foreground hover:bg-background-quaternary-1'
              )}
            >
              <span className="flex-1 truncate">{getDisplayLabel(item)}</span>
              {getDisplayDescription(item) && (
                <span className="truncate text-xs text-foreground-muted">
                  {getDisplayDescription(item)}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }
);
