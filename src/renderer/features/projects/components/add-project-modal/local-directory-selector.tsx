import { Folder } from 'lucide-react';
import { useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';

interface LocalDirectorySelectorProps {
  title: string;
  message: string;
  path?: string;
  onPathChange: (path: string) => void;
  placeholder?: string;
}

export function LocalDirectorySelector({
  title,
  message,
  onPathChange,
  path: initialPath,
  placeholder = 'Select a directory',
}: LocalDirectorySelectorProps) {
  const [path, setPath] = useState<string>(initialPath || '');

  const handleOpenFileDialog = async () => {
    const result = await rpc.app.openSelectDirectoryDialog({
      title,
      message,
    });
    if (result) {
      setPath(result);
      onPathChange(result);
    }
  };

  return (
    <button
      type="button"
      className="flex h-9 w-full items-center gap-2 rounded-md border border-border p-2 pr-1.5 transition-colors hover:bg-background-quaternary-1"
      onClick={handleOpenFileDialog}
    >
      <Folder className="size-4 text-foreground-muted" />
      <p
        className={cn(
          'text-sm text-foreground-passive truncate min-w-0 flex-1 w-full text-left',
          path ? 'text-foreground' : ''
        )}
      >
        {' '}
        {path || placeholder}
      </p>
      <Button variant="outline" size="xs">
        Choose
      </Button>
    </button>
  );
}
