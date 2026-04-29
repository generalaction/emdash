import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type PullRequest } from '@shared/pull-requests';
import { rpc } from '@renderer/lib/ipc';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@renderer/lib/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { cn } from '@renderer/utils/utils';

type StatusFilter = 'open' | 'not-open';

export interface InlinePrSelectorProps {
  value: PullRequest | null;
  onValueChange: (pr: PullRequest | null) => void;
  projectId?: string;
  repositoryUrl?: string;
  disabled?: boolean;
}

function PrRow({ pr }: { pr: PullRequest }) {
  return (
    <div className="flex flex-col min-w-0 gap-0.5">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="font-mono text-xs text-foreground-muted shrink-0">
          {pr.identifier ?? ''}
        </span>
        {pr.isDraft && (
          <span className="text-xs text-foreground-muted border border-border rounded px-1 shrink-0">
            Draft
          </span>
        )}
        <span className="truncate text-sm">{pr.title}</span>
      </div>
      <div className="flex items-center gap-1 text-xs text-foreground-muted">
        <code className="text-xs">{pr.headRefName}</code>
        {pr.author && (
          <>
            <span>·</span>
            <span>{pr.author.userName}</span>
          </>
        )}
      </div>
    </div>
  );
}

export function InlinePrSelector({
  value,
  onValueChange,
  projectId,
  repositoryUrl = '',
  disabled,
}: InlinePrSelectorProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');

  const { data } = useQuery({
    queryKey: ['pull-requests-inline', projectId, repositoryUrl, statusFilter],
    queryFn: async () => {
      const response = await rpc.pullRequests.listPullRequests(projectId!, {
        limit: 50,
        offset: 0,
        filters: { status: statusFilter },
      });
      if (!response?.success) throw new Error(response?.error ?? 'Failed to load pull requests');
      return (response.prs ?? []) as PullRequest[];
    },
    enabled: !!projectId && !!repositoryUrl,
    staleTime: 30_000,
  });

  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredPrs = useMemo(() => {
    const prs = data ?? [];
    if (!query.trim()) return prs;
    const lower = query.trim().toLowerCase();
    return prs.filter(
      (pr) =>
        pr.title.toLowerCase().includes(lower) ||
        pr.headRefName.toLowerCase().includes(lower) ||
        (pr.identifier ?? '').toLowerCase().includes(lower)
    );
  }, [data, query]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[highlightedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setHighlightedIndex(0);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (filteredPrs.length === 0) return;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightedIndex((prev) => Math.min(prev + 1, filteredPrs.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter': {
          e.preventDefault();
          const pr = filteredPrs[highlightedIndex];
          if (pr) onValueChange(value?.url === pr.url ? null : pr);
          break;
        }
        case 'Escape':
          e.preventDefault();
          if (query) {
            setQuery('');
            setHighlightedIndex(0);
          }
          break;
      }
    },
    [filteredPrs, highlightedIndex, value, query, onValueChange]
  );

  return (
    <div
      className={cn(
        'flex flex-col min-w-0 rounded-md border border-input overflow-hidden',
        disabled && 'pointer-events-none'
      )}
    >
      <InputGroup className="rounded-none border-0 border-b border-input shadow-none has-[[data-slot=input-group-control]:focus-visible]:ring-0 has-[[data-slot=input-group-control]:focus-visible]:border-input">
        <InputGroupInput
          ref={inputRef}
          value={query}
          onChange={handleQueryChange}
          onKeyDown={handleKeyDown}
          placeholder="Search pull requests…"
          autoFocus
        />
        <InputGroupAddon align="inline-end">
          <Popover>
            <PopoverTrigger className="flex items-center gap-1 text-sm text-foreground-muted hover:text-foreground">
              {statusFilter === 'open' ? 'Open' : 'Closed'}
              <ChevronDown className="size-3.5" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-36 p-1">
              {(['open', 'not-open'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                  onClick={() => {
                    setStatusFilter(s);
                    setQuery('');
                    setHighlightedIndex(0);
                  }}
                >
                  <span className="flex-1 text-left">{s === 'open' ? 'Open' : 'Closed'}</span>
                  {statusFilter === s && <Check className="size-3.5 shrink-0 text-foreground" />}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </InputGroupAddon>
      </InputGroup>

      <div ref={listRef} className="overflow-y-auto overflow-x-hidden h-52 p-1">
        {filteredPrs.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {query
              ? 'No pull requests found'
              : statusFilter === 'open'
                ? 'No open pull requests to show'
                : 'No closed pull requests to show'}
          </div>
        ) : (
          filteredPrs.map((pr, index) => {
            const isSelected = value?.url === pr.url;
            const isHighlighted = index === highlightedIndex;
            return (
              <button
                key={pr.url}
                type="button"
                className={cn(
                  'relative flex min-w-0 w-full cursor-default items-center gap-2 rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none select-none',
                  isHighlighted && 'bg-background-2',
                  isSelected && 'bg-background-2'
                )}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => onValueChange(isSelected ? null : pr)}
              >
                <PrRow pr={pr} />
                {isSelected && (
                  <Check className="absolute right-2 size-3.5 shrink-0 text-foreground-muted" />
                )}
              </button>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-between h-6 px-2 text-xs bg-background-1 border-t border-border">
        <div className="text-foreground-muted">Navigate with arrow keys</div>
        <div className="text-foreground-muted">
          <button className="flex items-center gap-2">
            Select PR <ShortcutHint settingsKey="confirm" />
          </button>
        </div>
      </div>
    </div>
  );
}
