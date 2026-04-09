import { Folder } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { rpc } from '@renderer/core/ipc';
import { cn } from '@renderer/lib/utils';

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
      className="h-9 border border-border rounded-md p-2 w-full flex items-center gap-2 hover:bg-background-1 transition-colors"
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
