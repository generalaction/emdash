import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/select';
import { Search } from 'lucide-react';
import plainLogoSvg from '../../assets/images/Plain.svg?raw';
import { type PlainThreadSummary } from '../types/plain';
import { Separator } from './ui/separator';
import { Spinner } from './ui/spinner';
import AgentLogo from './AgentLogo';

const STATUS_OPTIONS = [
  { value: null, label: 'All' },
  { value: 'TODO', label: 'Todo' },
  { value: 'SNOOZED', label: 'Snoozed' },
  { value: 'DONE', label: 'Done' },
] as const;

type StatusFilter = 'TODO' | 'SNOOZED' | 'DONE' | null;

function statusColor(status?: string | null): string {
  switch (status) {
    case 'TODO':
      return 'bg-amber-500/20 text-amber-700 dark:text-amber-400';
    case 'DONE':
      return 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400';
    case 'SNOOZED':
      return 'bg-blue-500/20 text-blue-700 dark:text-blue-400';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

interface PlainThreadSelectorProps {
  selectedThread: PlainThreadSummary | null;
  onThreadChange: (thread: PlainThreadSummary | null) => void;
  isOpen?: boolean;
  className?: string;
  disabled?: boolean;
  autoOpen?: boolean;
  onAutoOpenHandled?: () => void;
  placeholder?: string;
}

export const PlainThreadSelector: React.FC<PlainThreadSelectorProps> = ({
  selectedThread,
  onThreadChange,
  isOpen = false,
  className = '',
  disabled = false,
  autoOpen = false,
  onAutoOpenHandled,
  placeholder: customPlaceholder,
}) => {
  const [availableThreads, setAvailableThreads] = useState<PlainThreadSummary[]>([]);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [threadListError, setThreadListError] = useState<string | null>(null);
  const [hasRequestedThreads, setHasRequestedThreads] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<PlainThreadSummary[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('TODO');
  const isMountedRef = useRef(true);
  const [visibleCount, setVisibleCount] = useState(10);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const canListPlain = typeof window !== 'undefined' && !!window.electronAPI?.plainInitialFetch;
  const threadsLoaded = availableThreads.length > 0;
  const isDisabled = disabled || isLoadingThreads;

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setAvailableThreads([]);
      setHasRequestedThreads(false);
      setThreadListError(null);
      setIsLoadingThreads(false);
      setSearchTerm('');
      setSearchResults([]);
      setIsSearching(false);
      onThreadChange(null);
      setVisibleCount(10);
      setStatusFilter('TODO');
    }
  }, [isOpen, onThreadChange]);

  useEffect(() => {
    if (!isOpen) {
      setDropdownOpen(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (autoOpen) {
      setDropdownOpen(true);
      onAutoOpenHandled?.();
    }
  }, [autoOpen, onAutoOpenHandled]);

  const loadPlainThreads = useCallback(
    async (statuses?: string[]) => {
      if (!canListPlain) {
        return;
      }

      const api = window.electronAPI;
      if (!api?.plainInitialFetch) {
        setAvailableThreads([]);
        setThreadListError('Plain thread list unavailable in this build.');
        setHasRequestedThreads(true);
        return;
      }

      setIsLoadingThreads(true);
      try {
        const result = await api.plainInitialFetch(50, statuses);
        if (!isMountedRef.current) return;
        if (!result?.success) {
          throw new Error(result?.error || 'Failed to load Plain threads.');
        }
        setAvailableThreads(result.threads ?? []);
        setThreadListError(null);
      } catch (error) {
        if (!isMountedRef.current) return;
        setAvailableThreads([]);
        setThreadListError(
          error instanceof Error ? error.message : 'Failed to load Plain threads.'
        );
      } finally {
        if (!isMountedRef.current) return;
        setIsLoadingThreads(false);
        setHasRequestedThreads(true);
      }
    },
    [canListPlain]
  );

  // Initial load
  useEffect(() => {
    if (!isOpen || !canListPlain || isLoadingThreads || hasRequestedThreads) return;
    loadPlainThreads(statusFilter ? [statusFilter] : undefined);
  }, [isOpen, canListPlain, isLoadingThreads, hasRequestedThreads, loadPlainThreads, statusFilter]);

  // Reload when status filter changes
  const handleStatusFilterChange = useCallback((newStatus: StatusFilter) => {
    setStatusFilter(newStatus);
    setHasRequestedThreads(false);
    setAvailableThreads([]);
  }, []);

  const searchThreads = useCallback(async (term: string) => {
    if (!term.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const api = window.electronAPI;
    if (!api?.plainSearchThreads) {
      return;
    }

    setIsSearching(true);
    try {
      const result = await api.plainSearchThreads(term.trim(), 20);
      if (!isMountedRef.current) return;
      if (result?.success) {
        setSearchResults(result.threads ?? []);
        void (async () => {
          const { captureTelemetry } = await import('../lib/telemetryClient');
          captureTelemetry('plain_threads_searched');
        })();
      } else {
        setSearchResults([]);
      }
    } catch {
      if (!isMountedRef.current) return;
      setSearchResults([]);
    } finally {
      if (!isMountedRef.current) return;
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      searchThreads(searchTerm);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchTerm, searchThreads]);

  const displayThreads = useMemo(() => {
    if (searchTerm.trim()) {
      return searchResults;
    }
    return availableThreads;
  }, [searchTerm, searchResults, availableThreads]);

  useEffect(() => {
    setVisibleCount(10);
  }, [searchTerm]);

  const showThreads = useMemo(
    () => displayThreads.slice(0, Math.max(10, visibleCount)),
    [displayThreads, visibleCount]
  );

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 16;
      if (nearBottom && showThreads.length < displayThreads.length) {
        setVisibleCount((prev) => Math.min(prev + 10, displayThreads.length));
      }
    },
    [displayThreads.length, showThreads.length]
  );

  const handleThreadSelect = (id: string) => {
    if (id === '__clear__') {
      onThreadChange(null);
      return;
    }
    const thread = displayThreads.find((t) => t.id === id) ?? null;
    if (thread) {
      void (async () => {
        const { captureTelemetry } = await import('../lib/telemetryClient');
        captureTelemetry('plain_thread_selected');
      })();
    }
    onThreadChange(thread);
  };

  const threadHelperText = (() => {
    if (!canListPlain) {
      return 'Connect Plain in Settings to browse threads.';
    }
    if (hasRequestedThreads && !isLoadingThreads && !threadsLoaded && !threadListError) {
      return 'No Plain threads available.';
    }
    return null;
  })();

  const threadPlaceholder =
    customPlaceholder ??
    (isLoadingThreads
      ? 'Loading…'
      : threadListError
        ? 'Error loading threads — try searching'
        : 'Select a Plain thread');

  if (!canListPlain) {
    return (
      <div className={className}>
        <Input value="" placeholder="Plain integration unavailable" disabled />
        <p className="mt-2 text-xs text-muted-foreground">
          Connect Plain in Settings to browse threads.
        </p>
      </div>
    );
  }

  return (
    <div className={`min-w-0 max-w-full overflow-hidden ${className}`} style={{ maxWidth: '100%' }}>
      <Select
        value={selectedThread?.id || '__clear__'}
        onValueChange={handleThreadSelect}
        disabled={isDisabled}
        open={dropdownOpen}
        onOpenChange={(open) => setDropdownOpen(open)}
      >
        <SelectTrigger
          className="h-9 w-full overflow-hidden border-none bg-muted"
          style={{ maxWidth: '100%' }}
        >
          <div className="flex w-full items-center gap-2 overflow-hidden text-left text-foreground">
            {selectedThread ? (
              <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                <span className="inline-flex items-center gap-1.5 rounded border border-border bg-muted px-1.5 py-0.5 dark:border-border dark:bg-card">
                  <AgentLogo
                    logo={plainLogoSvg}
                    alt="Plain"
                    className="h-3.5 w-3.5 text-foreground"
                  />
                  {selectedThread.ref ? (
                    <span className="text-[11px] font-medium text-foreground">
                      {selectedThread.ref}
                    </span>
                  ) : null}
                  {selectedThread.status ? (
                    <span
                      className={`rounded px-1 text-[10px] font-medium ${statusColor(selectedThread.status)}`}
                    >
                      {selectedThread.status}
                    </span>
                  ) : null}
                </span>
                {selectedThread.title ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                    <span className="truncate text-muted-foreground">{selectedThread.title}</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <AgentLogo
                  logo={plainLogoSvg}
                  alt="Plain"
                  className="h-3.5 w-3.5 text-foreground"
                />
                {isLoadingThreads ? (
                  <>
                    <span className="truncate text-muted-foreground">Loading Plain threads</span>
                    <Spinner size="sm" />
                  </>
                ) : (
                  <span className="truncate text-muted-foreground">{threadPlaceholder}</span>
                )}
              </>
            )}
          </div>
        </SelectTrigger>
        <SelectContent side="top" className="z-[120] w-full max-w-[480px]">
          <div className="relative px-3 py-2">
            <Search className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search threads (e.g. T-747)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={disabled}
              className="h-7 w-full border-none bg-transparent pl-9 pr-3 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
          <div className="flex gap-1 px-3 pb-2">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                type="button"
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  statusFilter === opt.value
                    ? 'bg-foreground/10 text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleStatusFilterChange(opt.value as StatusFilter);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <Separator />
          <div className="max-h-80 overflow-y-auto overflow-x-hidden py-1" onScroll={handleScroll}>
            <SelectItem value="__clear__">
              <span className="text-sm text-muted-foreground">None</span>
            </SelectItem>
            <Separator className="my-1" />
            {showThreads.length > 0 ? (
              showThreads.map((thread) => (
                <SelectItem key={thread.id} value={thread.id}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-border bg-muted px-1.5 py-0.5 dark:border-border dark:bg-card">
                      <AgentLogo
                        logo={plainLogoSvg}
                        alt="Plain"
                        className="h-3.5 w-3.5 text-foreground"
                      />
                    </span>
                    {thread.ref ? (
                      <span className="shrink-0 text-[11px] font-medium text-foreground">
                        {thread.ref}
                      </span>
                    ) : null}
                    {thread.status ? (
                      <span
                        className={`shrink-0 rounded px-1 text-[10px] font-medium ${statusColor(thread.status)}`}
                      >
                        {thread.status}
                      </span>
                    ) : null}
                    {thread.title ? (
                      <span className="truncate text-muted-foreground">{thread.title}</span>
                    ) : null}
                  </span>
                </SelectItem>
              ))
            ) : searchTerm.trim() ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                {isSearching ? (
                  <div className="flex items-center gap-2">
                    <Spinner size="sm" />
                    <span>Searching</span>
                  </div>
                ) : (
                  `No threads found for "${searchTerm}"`
                )}
              </div>
            ) : isLoadingThreads ? (
              <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                <Spinner size="sm" />
                <span>Loading threads</span>
              </div>
            ) : (
              <div className="px-3 py-2 text-sm text-muted-foreground">No threads available</div>
            )}
          </div>
        </SelectContent>
      </Select>
      {threadHelperText ? (
        <p className="mt-2 text-xs text-muted-foreground">{threadHelperText}</p>
      ) : null}
    </div>
  );
};

export default PlainThreadSelector;
