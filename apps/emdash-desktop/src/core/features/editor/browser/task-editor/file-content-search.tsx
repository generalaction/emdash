import {
  portableRelativePathBasename,
  portableRelativePathDirname,
} from '@emdash/core/primitives/path/api';
import type {
  ContentSearchFileResult,
  ContentSearchLineMatch,
} from '@emdash/core/runtimes/file-search/api';
import { createLiveJobReplica, LiveJobCancelledError, LiveJobFailedError } from '@emdash/wire';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useMemo, useRef, useState, useEffect } from 'react';
import { FileIcon } from '@core/features/editor/api/browser/renderers/file-icon';
import type {
  FileSelection,
  FileTabResource,
} from '@core/features/editor/api/browser/task-editor/stores/file-tab-resource';
import { searchContract } from '@core/features/search/api';
import { useTaskComposition } from '@core/features/workbench/api/browser/task-composition-context';
import { useDebounce } from '@renderer/lib/hooks/useDebounce';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import {
  countContentSearchOccurrences,
  highlightSegments,
  mergeContentSearchFiles,
} from './file-content-search-model';

const SEARCH_DEBOUNCE_MS = 200;

type SearchState = Readonly<{
  files: ContentSearchFileResult[];
  isSearching: boolean;
  complete: boolean;
  error: string | null;
}>;

type SearchRow =
  | Readonly<{
      kind: 'file';
      file: ContentSearchFileResult;
      occurrenceCount: number;
    }>
  | Readonly<{
      kind: 'match';
      path: ContentSearchFileResult['path'];
      match: ContentSearchLineMatch;
    }>;

const INITIAL_SEARCH_STATE: SearchState = {
  files: [],
  isSearching: true,
  complete: true,
  error: null,
};

export function FileContentSearchResults({
  workspaceId,
  query,
}: {
  workspaceId: string;
  query: string;
}) {
  const taskView = useTaskComposition();
  const debouncedQuery = useDebounce(query, SEARCH_DEBOUNCE_MS);
  const [state, setState] = useState<SearchState>(INITIAL_SEARCH_STATE);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setState(INITIAL_SEARCH_STATE);
    if (query !== debouncedQuery || !debouncedQuery) return;

    let disposed = false;
    let cancelActiveJob: (() => void) | undefined;

    void (async () => {
      try {
        const client = await getDesktopWireClient();
        if (disposed) return;
        const jobs = createLiveJobReplica(
          searchContract.searchWorkspaceContent,
          client.search.searchWorkspaceContent
        );
        let lease: Awaited<ReturnType<typeof jobs.start>> | undefined;
        let unsubscribe: (() => void) | undefined;
        try {
          lease = await jobs.start({ workspaceId, query: debouncedQuery });
          const job = await lease.ready();
          cancelActiveJob = () => void job.cancel();
          if (disposed) {
            await job.cancel();
            return;
          }

          unsubscribe = job.onProgress((progress) => {
            if (disposed) return;
            setState((current) => ({
              ...current,
              files: mergeContentSearchFiles(current.files, progress.files),
            }));
          });

          const result = await job.result;
          if (!disposed) {
            setState({
              files: result.files,
              isSearching: false,
              complete: result.complete,
              error: null,
            });
          }
        } finally {
          unsubscribe?.();
          await lease?.release();
          await jobs.dispose();
        }
      } catch (error) {
        if (!disposed && !(error instanceof LiveJobCancelledError)) {
          setState({
            files: [],
            isSearching: false,
            complete: true,
            error: contentSearchErrorMessage(error),
          });
        }
      }
    })();

    return () => {
      disposed = true;
      cancelActiveJob?.();
    };
  }, [debouncedQuery, query, workspaceId]);

  const rows = useMemo<SearchRow[]>(() => {
    const nextRows: SearchRow[] = [];
    for (const file of state.files) {
      nextRows.push({
        kind: 'file',
        file,
        occurrenceCount: countContentSearchOccurrences([file]),
      });
      if (collapsedPaths.has(file.path)) continue;
      for (const match of file.matches) {
        nextRows.push({ kind: 'match', path: file.path, match });
      }
    }
    return nextRows;
  }, [collapsedPaths, state.files]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.kind === 'file' ? 28 : 26),
    overscan: 12,
  });

  const occurrenceCount = countContentSearchOccurrences(state.files);
  const resultSummary = `${occurrenceCount} ${occurrenceCount === 1 ? 'result' : 'results'} in ${state.files.length} ${state.files.length === 1 ? 'file' : 'files'}`;

  const toggleFile = (path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const openMatch = (path: string, match: ContentSearchLineMatch, preview: boolean) => {
    const location = match.locations[0];
    if (!location) return;
    taskView.paneLayout.open('file', { path }, { preview });
    const resource = taskView.activePane.activeResourceOfKind<FileTabResource>('file');
    if (!resource) return;
    const selection: FileSelection = {
      lineNumber: match.lineNumber,
      startColumn: location.sourceRange.startColumn,
      endColumn: location.sourceRange.endColumn,
    };
    resource.requestSelection(selection);
    taskView.setFocusedRegion('main');
  };

  const focusAdjacentResult = (event: React.KeyboardEvent<HTMLButtonElement>, offset: -1 | 1) => {
    const buttons = scrollRef.current?.querySelectorAll<HTMLButtonElement>('[data-search-result]');
    if (!buttons?.length) return;
    const index = [...buttons].indexOf(event.currentTarget);
    const next = buttons[index + offset];
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="text-muted-foreground flex h-8 shrink-0 items-center gap-1.5 px-3 text-xs">
        {state.isSearching && <Loader2 className="size-3 animate-spin" aria-label="Searching" />}
        <span>{resultSummary}</span>
      </div>

      {state.error ? (
        <div className="text-destructive px-3 py-6 text-center text-xs">{state.error}</div>
      ) : !state.isSearching && state.files.length === 0 ? (
        <div className="text-muted-foreground px-3 py-6 text-center text-xs">No results found</div>
      ) : (
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
          role="tree"
          aria-label="File content search results"
        >
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              if (!row) return null;
              const style: React.CSSProperties = {
                position: 'absolute',
                top: item.start,
                left: 0,
                width: '100%',
                height: item.size,
              };
              if (row.kind === 'file') {
                const filename = portableRelativePathBasename(row.file.path);
                const dirname = portableRelativePathDirname(row.file.path);
                const collapsed = collapsedPaths.has(row.file.path);
                return (
                  <button
                    key={`file:${row.file.path}`}
                    type="button"
                    data-search-result
                    className="flex w-full items-center gap-1 rounded-md px-1 text-left text-xs outline-none hover:bg-background-1 focus:bg-background-2"
                    style={style}
                    onClick={() => toggleFile(row.file.path)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown') focusAdjacentResult(event, 1);
                      if (event.key === 'ArrowUp') focusAdjacentResult(event, -1);
                    }}
                    role="treeitem"
                    aria-expanded={!collapsed}
                  >
                    {collapsed ? (
                      <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                    ) : (
                      <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
                    )}
                    <FileIcon filename={filename} size={12} />
                    <span className="shrink-0 truncate font-medium">{filename}</span>
                    {dirname && (
                      <span className="text-muted-foreground min-w-0 flex-1 truncate">
                        {dirname}
                      </span>
                    )}
                    <span className="text-muted-foreground ml-auto shrink-0 tabular-nums">
                      {row.occurrenceCount}
                    </span>
                  </button>
                );
              }

              return (
                <button
                  key={`match:${row.path}:${row.match.lineNumber}`}
                  type="button"
                  data-search-result
                  className="flex w-full items-center rounded-md pr-1 text-left font-mono text-xs outline-none hover:bg-background-1 focus:bg-background-2"
                  style={style}
                  onClick={() => openMatch(row.path, row.match, true)}
                  onDoubleClick={() => openMatch(row.path, row.match, false)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') focusAdjacentResult(event, 1);
                    if (event.key === 'ArrowUp') focusAdjacentResult(event, -1);
                  }}
                  role="treeitem"
                  title={`${row.path}:${row.match.lineNumber}`}
                >
                  <span className="text-muted-foreground w-12 shrink-0 pr-2 text-right tabular-nums">
                    {row.match.lineNumber}
                  </span>
                  <span className="min-w-0 flex-1 truncate whitespace-pre">
                    {highlightSegments(
                      row.match.previewText,
                      row.match.locations.map((location) => location.previewRange)
                    ).map((segment, index) =>
                      segment.highlighted ? (
                        <mark
                          key={index}
                          className="rounded-sm bg-yellow-300/60 text-inherit dark:bg-yellow-500/35"
                        >
                          {segment.text}
                        </mark>
                      ) : (
                        <span key={index}>{segment.text}</span>
                      )
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!state.isSearching && !state.complete && (
        <div className="text-muted-foreground shrink-0 border-t border-border px-3 py-2 text-xs">
          Results were limited. Refine your search to see more.
        </div>
      )}
    </div>
  );
}

function contentSearchErrorMessage(error: unknown): string {
  const payload = error instanceof LiveJobFailedError ? error.error : error;
  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    const message = payload.message;
    if (typeof message === 'string') return message;
  }
  return error instanceof Error ? error.message : 'Search failed';
}
