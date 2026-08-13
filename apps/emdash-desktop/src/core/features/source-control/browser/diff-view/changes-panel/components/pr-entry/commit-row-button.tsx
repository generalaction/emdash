import type { Commit } from '@emdash/core/runtimes/git/api';
import { RelativeTime, Tooltip } from '@emdash/ui/react/primitives';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '@core/primitives/styling/browser/cn';

interface CommitRowButtonProps {
  commit: Commit;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}

/**
 * The clickable commit row. Hovering it shows the full subject in a tooltip,
 * but only when the subject line is actually truncated; truncation is measured
 * when the tooltip asks to open, so panel resizes never leave the answer stale.
 */
export function CommitRowButton({ commit, isExpanded, onToggleExpanded }: CommitRowButtonProps) {
  const subjectRef = useRef<HTMLSpanElement>(null);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const shortHash = commit.hash.slice(0, 7);

  return (
    <Tooltip.Root
      open={tooltipOpen}
      onOpenChange={(open) => {
        const subject = subjectRef.current;
        setTooltipOpen(open && subject !== null && subject.scrollWidth > subject.clientWidth);
      }}
    >
      <Tooltip.Trigger
        render={
          <button
            className={cn(
              'group flex w-full rounded-md px-1.5 py-1 text-left hover:bg-background-1',
              isExpanded && 'bg-background-1'
            )}
            onClick={onToggleExpanded}
            onContextMenu={() => setTooltipOpen(false)}
          />
        }
      >
        <span className="min-w-0 flex-1">
          <span ref={subjectRef} className="block truncate text-sm">
            {commit.subject}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-xs text-foreground-muted">
            <span className="min-w-0 truncate font-medium">{commit.author}</span>
            {'·'}
            <RelativeTime compact value={commit.date} className="text-foreground-muted" />
            {'·'}
            <span className="font-mono text-foreground-passive">{shortHash}</span>
            {isExpanded ? (
              <ChevronDown className="size-3.5 shrink-0 text-foreground-muted" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0 text-foreground-muted" />
            )}
          </span>
        </span>
      </Tooltip.Trigger>
      <Tooltip.Content className="wrap-break-word">{commit.subject}</Tooltip.Content>
    </Tooltip.Root>
  );
}
