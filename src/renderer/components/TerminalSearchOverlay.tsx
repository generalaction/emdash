import React, { type RefObject } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import type { TerminalSearchStatus } from '../hooks/useTerminalSearch';

interface Props {
  isOpen: boolean;
  fullWidth?: boolean;
  searchQuery: string;
  searchStatus: TerminalSearchStatus;
  searchInputRef: RefObject<HTMLInputElement>;
  onQueryChange: (value: string) => void;
  onStep: (direction: 'next' | 'prev') => void;
  onClose: () => void;
}

export const TerminalSearchOverlay: React.FC<Props> = ({
  isOpen,
  fullWidth = false,
  searchQuery,
  searchStatus,
  searchInputRef,
  onQueryChange,
  onStep,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className={cn(
        'absolute top-3 z-20 flex items-center gap-1 rounded-md border border-border bg-background/95 p-1.5 shadow-lg backdrop-blur',
        fullWidth ? 'left-3 right-3 w-auto max-w-none' : 'right-3 w-[min(28rem,calc(100%-1.5rem))]'
      )}
    >
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
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
          placeholder="Find in terminal..."
          className="h-8 min-w-0 border-0 bg-transparent pl-8 pr-2 text-xs shadow-none focus-visible:ring-0"
          aria-label="Find in terminal"
        />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <span className="min-w-10 shrink-0 px-1 text-center text-[11px] text-muted-foreground">
          {searchQuery ? `${searchStatus.currentIndex}/${searchStatus.total}` : '0/0'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onStep('prev')}
          disabled={!searchQuery || searchStatus.total === 0}
          className="shrink-0 text-muted-foreground"
          aria-label="Previous terminal match"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onStep('next')}
          disabled={!searchQuery || searchStatus.total === 0}
          className="shrink-0 text-muted-foreground"
          aria-label="Next terminal match"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          className="shrink-0 text-muted-foreground"
          aria-label="Close terminal search"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
};

export default TerminalSearchOverlay;
