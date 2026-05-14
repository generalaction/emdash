import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileCode,
  Folder,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { FileEntry } from '@shared/ssh';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';

interface RemoteDirectorySelectorProps {
  connectionId: string | undefined;
  value: string;
  onChange: (path: string) => void;
}

interface DirectoryHistoryState {
  entries: string[];
  index: number;
}

type DirectoryHistoryAction =
  | { type: 'reset'; path: string }
  | { type: 'push'; path: string }
  | { type: 'replace'; path: string }
  | { type: 'back' }
  | { type: 'forward' };

interface LoadDirectoryOptions {
  force?: boolean;
}

function normalizePath(path: string | undefined) {
  const trimmed = path?.trim() || '/';
  const absolutePath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return absolutePath === '/' ? absolutePath : absolutePath.replace(/\/+$/, '');
}

function initialBrowsePath(path: string) {
  return path.trim().length > 0 ? normalizePath(path) : '/';
}

function parentPath(path: string) {
  if (path === '/') return '/';
  return path.split('/').slice(0, -1).join('/') || '/';
}

function directoryCacheKey(connectionId: string, path: string) {
  return `${connectionId}\0${path}`;
}

function directoryHistoryReducer(
  state: DirectoryHistoryState,
  action: DirectoryHistoryAction
): DirectoryHistoryState {
  switch (action.type) {
    case 'reset':
      return { entries: [action.path], index: 0 };
    case 'replace': {
      const entries = [...state.entries];
      entries[state.index] = action.path;
      return { entries, index: state.index };
    }
    case 'push': {
      const activeEntries = state.entries.slice(0, state.index + 1);
      if (activeEntries[activeEntries.length - 1] === action.path) return state;
      return { entries: [...activeEntries, action.path], index: activeEntries.length };
    }
    case 'back':
      return { ...state, index: Math.max(0, state.index - 1) };
    case 'forward':
      return { ...state, index: Math.min(state.entries.length - 1, state.index + 1) };
  }
}

function useRemoteDirectoryBrowser(connectionId: string | undefined, initialPath: string) {
  const [currentPath, setCurrentPath] = useState<string>(initialPath);
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const directoryCacheRef = useRef(new Map<string, FileEntry[]>());
  const inFlightRequestsRef = useRef(new Map<string, Promise<FileEntry[]>>());
  const cacheWriteRequestIdsRef = useRef(new Map<string, number>());
  const latestRequestIdRef = useRef(0);

  const resetPath = useCallback((path: string) => {
    setCurrentPath(path);
    setLoadedPath(null);
  }, []);

  const loadDirectory = useCallback(
    async (path: string, options?: LoadDirectoryOptions): Promise<boolean> => {
      if (!connectionId) return false;

      const nextPath = normalizePath(path);
      const requestId = latestRequestIdRef.current + 1;
      latestRequestIdRef.current = requestId;
      const cacheKey = directoryCacheKey(connectionId, nextPath);

      setCurrentPath(nextPath);
      setBrowseError(null);

      const cachedEntries = directoryCacheRef.current.get(cacheKey);
      if (!options?.force && cachedEntries) {
        setFileEntries(cachedEntries);
        setLoadedPath(nextPath);
        setIsBrowsing(false);
        return true;
      }

      setIsBrowsing(true);
      let request = options?.force ? undefined : inFlightRequestsRef.current.get(cacheKey);

      if (!request) {
        cacheWriteRequestIdsRef.current.set(cacheKey, requestId);
        request = rpc.ssh
          .listFiles({ connectionId, path: nextPath })
          .then((entries) => {
            if (cacheWriteRequestIdsRef.current.get(cacheKey) === requestId) {
              directoryCacheRef.current.set(cacheKey, entries);
            }
            return entries;
          })
          .finally(() => {
            if (inFlightRequestsRef.current.get(cacheKey) === request) {
              inFlightRequestsRef.current.delete(cacheKey);
            }
            if (cacheWriteRequestIdsRef.current.get(cacheKey) === requestId) {
              cacheWriteRequestIdsRef.current.delete(cacheKey);
            }
          });

        inFlightRequestsRef.current.set(cacheKey, request);
      }

      try {
        const entries = await request;
        if (latestRequestIdRef.current !== requestId) return false;

        setFileEntries(entries);
        setLoadedPath(nextPath);
        return true;
      } catch (e) {
        if (latestRequestIdRef.current !== requestId) return false;

        setBrowseError(e instanceof Error ? e.message : 'Failed to list directory');
        setFileEntries([]);
        setLoadedPath(null);
        return false;
      } finally {
        if (latestRequestIdRef.current === requestId) setIsBrowsing(false);
      }
    },
    [connectionId]
  );

  useEffect(() => {
    directoryCacheRef.current.clear();
    inFlightRequestsRef.current.clear();
    cacheWriteRequestIdsRef.current.clear();
    latestRequestIdRef.current += 1;
    setLoadedPath(null);
    if (connectionId) void loadDirectory(currentPath, { force: true });
    // Only reconnect/connection-switch should clear the browsing cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  return {
    currentPath,
    setCurrentPath,
    fileEntries,
    isBrowsing,
    browseError,
    loadedPath,
    loadDirectory,
    resetPath,
  };
}

export function RemoteDirectorySelector({
  connectionId,
  value,
  onChange,
}: RemoteDirectorySelectorProps) {
  const initialPath = initialBrowsePath(value);
  const [open, setOpen] = useState(false);
  const [history, dispatchHistory] = useReducer(directoryHistoryReducer, {
    entries: [initialPath],
    index: 0,
  });
  const {
    currentPath,
    setCurrentPath,
    fileEntries,
    isBrowsing,
    browseError,
    loadedPath,
    loadDirectory,
    resetPath,
  } = useRemoteDirectoryBrowser(connectionId, initialPath);

  useEffect(() => {
    const nextPath = initialBrowsePath(value);
    resetPath(nextPath);
    dispatchHistory({ type: 'reset', path: nextPath });
  }, [resetPath, value]);

  const navigateToPath = async (path: string, options?: { replaceHistory?: boolean }) => {
    const nextPath = normalizePath(path);
    const loaded = await loadDirectory(nextPath);
    if (!loaded) return;
    dispatchHistory({ type: options?.replaceHistory ? 'replace' : 'push', path: nextPath });
  };

  const navigateTo = (entry: FileEntry) => {
    if (entry.type !== 'directory') return;
    void navigateToPath(entry.path);
  };

  const navigateUp = () => {
    void navigateToPath(parentPath(currentPath));
  };

  const navigateBack = () => {
    if (history.index === 0) return;
    const nextPath = history.entries[history.index - 1];
    dispatchHistory({ type: 'back' });
    void loadDirectory(nextPath);
  };

  const navigateForward = () => {
    if (history.index >= history.entries.length - 1) return;
    const nextPath = history.entries[history.index + 1];
    dispatchHistory({ type: 'forward' });
    void loadDirectory(nextPath);
  };

  const refreshCurrentPath = () => {
    void loadDirectory(currentPath, { force: true });
  };

  const handleManualPathChange = (path: string) => {
    setCurrentPath(path);
  };

  const handleManualPathSubmit = () => {
    void navigateToPath(currentPath, { replaceHistory: true });
  };

  const handleUseDirectory = () => {
    const selectedPath = normalizePath(currentPath);
    if (loadedPath !== selectedPath) return;
    onChange(selectedPath);
    setOpen(false);
  };

  const canUseCurrentDirectory = loadedPath === normalizePath(currentPath);

  const renderDirectoryList = () => {
    if (isBrowsing && fileEntries.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (browseError) {
      return (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-destructive">
          {browseError}
        </div>
      );
    }

    if (fileEntries.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Empty directory
        </div>
      );
    }

    return (
      <div className="divide-y divide-border">
        {fileEntries.map((entry) => {
          const isDirectory = entry.type === 'directory';
          const isSelectedPath = normalizePath(value) === normalizePath(entry.path);

          return (
            <button
              key={entry.path}
              type="button"
              onClick={() => navigateTo(entry)}
              disabled={!isDirectory}
              className={cn(
                'flex h-10 w-full items-center gap-2 px-3 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                isDirectory && 'cursor-pointer font-medium',
                !isDirectory && 'cursor-default opacity-50'
              )}
            >
              {isDirectory ? (
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <FileCode className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {isSelectedPath && <Check className="h-4 w-4 shrink-0 text-primary" />}
              {entry.type === 'file' && (
                <span className="text-xs text-muted-foreground">
                  {(entry.size / 1024).toFixed(1)} KB
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <Popover
        open={open}
        onOpenChange={(newOpen, eventDetails) => {
          if (!newOpen && eventDetails.reason === 'trigger-press') return;
          setOpen(newOpen);
          if (newOpen && connectionId) void loadDirectory(currentPath);
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              className="h-9 border border-border rounded-md p-2 w-full flex items-center gap-2 hover:bg-background-quaternary-1 pr-1.5 transition-colors disabled:pointer-events-none disabled:opacity-50"
              disabled={!connectionId}
            >
              <Folder className="size-4 text-foreground-muted" />
              <p
                className={cn(
                  'text-sm text-foreground-passive truncate min-w-0 flex-1 w-full text-left',
                  value ? 'text-foreground' : ''
                )}
              >
                {' '}
                {value || 'Select a directory'}
              </p>
              <Button variant="outline" size="xs">
                Choose
              </Button>
            </button>
          }
        />
        <PopoverContent
          align="start"
          sideOffset={4}
          className="h-[420px] w-[min(640px,calc(100vw-32px))] gap-0 overflow-hidden p-0"
        >
          <div className="flex items-center gap-1 border-b border-border bg-muted/40 px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Back"
              onClick={navigateBack}
              disabled={history.index === 0 || isBrowsing}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Forward"
              onClick={navigateForward}
              disabled={history.index >= history.entries.length - 1 || isBrowsing}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Up one directory"
              onClick={navigateUp}
              disabled={currentPath === '/' || isBrowsing}
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Refresh"
              onClick={refreshCurrentPath}
              disabled={isBrowsing}
            >
              <RefreshCw className={cn('h-4 w-4', isBrowsing && 'animate-spin')} />
            </Button>
            <Input
              className="ml-2 h-7 flex-1"
              value={currentPath}
              onChange={(e) => handleManualPathChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleManualPathSubmit();
                }
              }}
              disabled={isBrowsing}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">{renderDirectoryList()}</div>

          <div className="flex items-center justify-end border-t border-border bg-background-quaternary px-3 py-2">
            <Button
              type="button"
              size="sm"
              onClick={handleUseDirectory}
              disabled={isBrowsing || Boolean(browseError) || !canUseCurrentDirectory}
            >
              Use this directory
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {!connectionId && (
        <p className="text-xs text-muted-foreground">
          Select an SSH connection to browse remote directories.
        </p>
      )}
    </div>
  );
}
