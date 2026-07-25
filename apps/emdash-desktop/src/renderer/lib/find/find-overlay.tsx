import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import React, { type RefObject } from 'react';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';
import type { FindSearchStatus } from './types';

interface Props {
  isOpen: boolean;
  fullWidth?: boolean;
  /**
   * Renders in normal document flow above the scrollable content instead of
   * floating on top of it. Use this for short/list-like panels (file tree,
   * conversations list) where an absolutely-positioned overlay can hide the
   * only visible row; keep the default floating style for tall content
   * (terminal, chat, markdown) where that's the expected pattern.
   */
  inline?: boolean;
  /** Hides the prev/next chevrons for filter-style consumers with no notion of a "current" match. */
  hideStepControls?: boolean;
  searchQuery: string;
  searchStatus: FindSearchStatus;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onStep: (direction: 'next' | 'prev') => void;
  onClose: () => void;
  placeholder?: string;
  ariaLabel?: string;
}

export function FindOverlay({
  isOpen,
  fullWidth = false,
  inline = false,
  hideStepControls = false,
  searchQuery,
  searchStatus,
  searchInputRef,
  onQueryChange,
  onStep,
  onClose,
  placeholder = 'Find...',
  ariaLabel = 'Find',
}: Props) {
  if (!isOpen) return null;

  return (
    <div
      className={cn(
        'z-20 flex items-center gap-1 rounded-md border border-border bg-background p-1.5 shadow-lg',
        inline
          ? 'relative mb-2 w-full'
          : cn(
              'absolute top-3',
              fullWidth
                ? 'left-3 right-3 w-auto max-w-none'
                : 'right-3 w-[min(28rem,calc(100%-1.5rem))]'
            )
      )}
    >
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-foreground-muted" />
        <Input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !hideStepControls) {
              event.preventDefault();
              onStep(event.shiftKey ? 'prev' : 'next');
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }
          }}
          placeholder={placeholder}
          className="h-8 min-w-0 border-0 bg-transparent pr-2 pl-8 text-xs text-foreground shadow-none focus-visible:ring-0"
          aria-label={ariaLabel}
        />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <span className="min-w-10 shrink-0 px-1 text-center text-[11px] text-foreground-muted">
          {searchQuery
            ? hideStepControls
              ? searchStatus.total
              : `${searchStatus.currentIndex}/${searchStatus.total}`
            : hideStepControls
              ? ''
              : '0/0'}
        </span>
        {!hideStepControls && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => onStep('prev')}
              disabled={!searchQuery || searchStatus.total === 0}
              className="shrink-0 text-foreground-muted"
              aria-label="Previous match"
            >
              <ChevronUp className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => onStep('next')}
              disabled={!searchQuery || searchStatus.total === 0}
              className="shrink-0 text-foreground-muted"
              aria-label="Next match"
            >
              <ChevronDown className="size-3.5" />
            </Button>
          </>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          className="shrink-0 text-foreground-muted"
          aria-label="Close find"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
