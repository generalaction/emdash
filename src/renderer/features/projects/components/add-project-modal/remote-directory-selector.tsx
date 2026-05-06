import { ChevronUp, FileCode, Folder, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
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

export function RemoteDirectorySelector({
  connectionId,
  value,
  onChange,
}: RemoteDirectorySelectorProps) {
  const [currentPath, setCurrentPath] = useState<undefined | string>(value);
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (connectionId) void loadDirectory(currentPath || '/');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  const loadDirectory = async (path: string) => {
    if (!connectionId) return;
    setIsBrowsing(true);
    setBrowseError(null);
    try {
      const entries = await rpc.ssh.listFiles({ connectionId, path });
      setFileEntries(entries);
    } catch (e) {
      setBrowseError(e instanceof Error ? e.message : 'Failed to list directory');
      setFileEntries([]);
    } finally {
      setIsBrowsing(false);
    }
  };

  const navigateTo = (entry: FileEntry) => {
    if (entry.type !== 'directory') return;
    setCurrentPath(entry.path);
    onChange(entry.path);
    void loadDirectory(entry.path);
  };

  const navigateUp = () => {
    const parent = currentPath?.split('/').slice(0, -1).join('/') || '/';
    setCurrentPath(parent);
    onChange(parent);
    void loadDirectory(parent);
  };

  const handleManualPathChange = (path: string) => {
    setCurrentPath(path);
    onChange(path);
  };

  return (
    <div className="space-y-2">
      <Popover
        open={open}
        onOpenChange={(newOpen, eventDetails) => {
          // Prevent the trigger click from toggling the popover closed —
          // it should only close on outside press, Escape, or focus-out.
          if (!newOpen && eventDetails.reason === 'trigger-press') return;
          setOpen(newOpen);
        }}
      >
        <PopoverTrigger
          render={
            <Input
              placeholder="/home/user/project"
              value={currentPath}
              onChange={(e) => handleManualPathChange(e.target.value)}
              onFocus={() => {
                if (connectionId) {
                  setOpen(true);
                  void loadDirectory(currentPath || '/');
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void loadDirectory(currentPath || '/');
                }
              }}
              disabled={!connectionId}
            />
          }
        />
        <PopoverContent align="start" sideOffset={4} className="w-[--anchor-width] p-0">
          <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={navigateUp}
              disabled={currentPath === '/' || isBrowsing}
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-left">
              {currentPath || '/'}
            </span>
            {isBrowsing && (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
            )}
          </div>

          <div className="max-h-[240px] overflow-y-auto">
            {isBrowsing && fileEntries.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : browseError ? (
              <div className="py-4 text-center text-sm text-destructive">{browseError}</div>
            ) : fileEntries.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Empty directory</div>
            ) : (
              <div className="divide-y">
                {fileEntries.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() => navigateTo(entry)}
                    disabled={entry.type !== 'directory'}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent',
                      entry.type === 'directory' && 'cursor-pointer font-medium',
                      entry.type !== 'directory' && 'cursor-default opacity-50'
                    )}
                  >
                    {entry.type === 'directory' ? (
                      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <FileCode className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="flex-1 truncate">{entry.name}</span>
                    {entry.type === 'file' && (
                      <span className="text-xs text-muted-foreground">
                        {(entry.size / 1024).toFixed(1)} KB
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
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
