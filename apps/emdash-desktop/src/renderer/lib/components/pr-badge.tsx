import { ChevronDown, ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PrMergeLine } from '@renderer/lib/components/pr-merge-line';
import { PrNavigationButton } from '@renderer/lib/components/pr-navigation-button';
import { PrUrlCopyButton } from '@renderer/lib/components/pr-url-copy-button';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';
import { getPrNumber, type PullRequest } from '@shared/core/pull-requests/pull-requests';
import { RelativeTime } from '../ui/relative-time';
import { PrNumberBadge } from './pr-number-badge';
import { StatusIcon } from './pr-status-icon';

interface PrBadgeProps {
  variant?: 'default' | 'compact';
  pr: PullRequest;
  className?: string;
  hoverDelay?: number;
}

export function PrBadge({ variant = 'default', pr, className, hoverDelay }: PrBadgeProps) {
  const prNumber = getPrNumber(pr);
  const detailsAccessibleLabel = `Show details for pull request${
    prNumber == null ? `: ${pr.title}` : ` #${prNumber}`
  }`;
  const [previewOpen, setPreviewOpen] = useState(false);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (openTimerRef.current !== null) window.clearTimeout(openTimerRef.current);
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    },
    []
  );

  const openPreview = (delay = hoverDelay ?? 0) => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (previewOpen || openTimerRef.current !== null) return;
    if (delay <= 0) {
      setPreviewOpen(true);
      return;
    }
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      setPreviewOpen(true);
    }, delay);
  };

  const closePreview = () => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setPreviewOpen(false);
    }, 100);
  };

  const renderBadge = () => {
    switch (variant) {
      case 'default':
        return (
          <div
            className={cn(
              'flex h-full max-w-52 items-center gap-1.5 px-1.5 leading-none',
              className
            )}
          >
            <StatusIcon className="size-3" pr={pr} disableTooltip />
            <span className="shrink-0 font-sans text-xs leading-none">#{prNumber ?? 0}</span>
            <span className="truncate text-xs leading-none">{pr.title}</span>
            <ExternalLink
              aria-hidden="true"
              className="size-3 shrink-0 opacity-60 transition-opacity group-focus-within/pr-badge:opacity-100 group-hover/pr-badge:opacity-100"
            />
          </div>
        );
      case 'compact':
        return (
          <div
            className={cn('flex h-full items-center justify-center px-1 leading-none', className)}
          >
            <StatusIcon className="size-3" pr={pr} disableTooltip />
          </div>
        );
    }
  };

  return (
    <Popover open={previewOpen} onOpenChange={setPreviewOpen}>
      <span
        ref={badgeRef}
        className={cn(
          'group/pr-badge inline-flex h-5 items-center rounded-md border border-border bg-background-2 leading-none text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground focus-within:border-ring focus-within:text-foreground focus-within:ring-2 focus-within:ring-ring/50',
          variant === 'compact' &&
            'border-transparent bg-transparent hover:border-border hover:bg-background-2'
        )}
        onMouseMove={() => openPreview()}
        onMouseLeave={closePreview}
      >
        <PrNavigationButton
          pr={pr}
          className="group flex h-full min-w-0 items-center rounded-l-md outline-none focus-visible:bg-background-1"
        >
          {renderBadge()}
        </PrNavigationButton>
        <span className="flex h-full" onClick={(event) => event.stopPropagation()}>
          <PopoverTrigger
            type="button"
            aria-label={detailsAccessibleLabel}
            className={cn(
              'flex cursor-pointer items-center justify-center rounded-r-md border-l border-border outline-none hover:bg-background-2 focus-visible:bg-background-2',
              variant === 'compact' ? 'h-5 w-3' : 'size-5'
            )}
          >
            <ChevronDown
              aria-hidden="true"
              className={variant === 'compact' ? 'size-2' : 'size-3'}
            />
          </PopoverTrigger>
        </span>
      </span>
      <PopoverContent
        anchor={badgeRef}
        initialFocus={false}
        finalFocus={false}
        className="w-auto max-w-sm min-w-72"
        onMouseEnter={() => openPreview(0)}
        onMouseLeave={closePreview}
      >
        <div className="flex flex-col gap-2">
          <div className="no-wrap flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <StatusIcon pr={pr} className="size-3" disableTooltip />
              <span className="min-w-0 truncate text-sm leading-snug text-foreground">
                {pr.title}
              </span>
              <PrNumberBadge number={getPrNumber(pr) ?? 0} />
              <PrUrlCopyButton url={pr.url} />
            </div>
            <RelativeTime
              value={pr.createdAt}
              className="text-xs text-foreground-passive"
              compact
            />
          </div>
          <PrMergeLine pr={pr} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
