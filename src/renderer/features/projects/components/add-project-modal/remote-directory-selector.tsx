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
import { useCallback, useEffect, useRef, useState } from 'react';
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

export function RemoteDirectorySelector({
  connectionId,
  value,
  onChange,
}: RemoteDirectorySelectorProps) {
  const initialPath = initialBrowsePath(value);
  const [currentPath, setCurrentPath] = useState<string>(initialPath);
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<string[]>([initialPath]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const directoryCacheRef = useRef(new Map<string, FileEntry[]>());
  const inFlightRequestsRef = useRef(new Map<string, Promise<FileEntry[]>>());
  const latestRequestIdRef = useRef(0);

  useEffect(() => {
    const nextPath = initialBrowsePath(value);
    setCurrentPath(nextPath);
    setHistory([nextPath]);
    setHistoryIndex(0);
  }, [value]);

  const loadDirectory = useCallback(
    async (path: string, options?: { force?: boolean }): Promise<boolean> => {
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
        setIsBrowsing(false);
        return true;
      }

      setIsBrowsing(true);
      let request = options?.force ? undefined : inFlightRequestsRef.current.get(cacheKey);

      if (!request) {
        request = rpc.ssh
          .listFiles({ connectionId, path: nextPath })
          .then((entries) => {
            directoryCacheRef.current.set(cacheKey, entries);
            return entries;
          })
          .finally(() => {
            if (inFlightRequestsRef.current.get(cacheKey) === request) {
              inFlightRequestsRef.current.delete(cacheKey);
            }
          });

        inFlightRequestsRef.current.set(cacheKey, request);
      }

      try {
        const entries = await request;
        if (latestRequestIdRef.current !== requestId) return false;

        setFileEntries(entries);
        return true;
      } catch (e) {
        if (latestRequestIdRef.current !== requestId) return false;

        setBrowseError(e instanceof Error ? e.message : 'Failed to list directory');
        setFileEntries([]);
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
    latestRequestIdRef.current += 1;
    if (connectionId) void loadDirectory(currentPath, { force: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  const navigateToPath = async (path: string, options?: { replaceHistory?: boolean }) => {
    const nextPath = normalizePath(path);
    const loaded = await loadDirectory(nextPath);
    if (!loaded) return;
    if (!options?.replaceHistory && history[historyIndex] === nextPath) return;

    setHistory((previousHistory) => {
      if (options?.replaceHistory) {
        const updatedHistory = [...previousHistory];
        updatedHistory[historyIndex] = nextPath;
        return updatedHistory;
      }

      const activeHistory = previousHistory.slice(0, historyIndex + 1);
      const lastPath = activeHistory[activeHistory.length - 1];
      if (lastPath === nextPath) return activeHistory;
      return [...activeHistory, nextPath];
    });
    if (!options?.replaceHistory) setHistoryIndex((previousIndex) => previousIndex + 1);
  };

  const navigateTo = (entry: FileEntry) => {
    if (entry.type !== 'directory') return;
    void navigateToPath(entry.path);
  };

  const navigateUp = () => {
    void navigateToPath(parentPath(currentPath));
  };

  const navigateBack = () => {
    if (historyIndex === 0) return;
    const nextIndex = historyIndex - 1;
    const nextPath = history[nextIndex];
    setHistoryIndex(nextIndex);
    void loadDirectory(nextPath);
  };

  const navigateForward = () => {
    if (historyIndex >= history.length - 1) return;
    const nextIndex = historyIndex + 1;
    const nextPath = history[nextIndex];
    setHistoryIndex(nextIndex);
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
    onChange(selectedPath);
    setOpen(false);
  };

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
              disabled={historyIndex === 0 || isBrowsing}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Forward"
              onClick={navigateForward}
              disabled={historyIndex >= history.length - 1 || isBrowsing}
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
              disabled={isBrowsing || Boolean(browseError)}
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
