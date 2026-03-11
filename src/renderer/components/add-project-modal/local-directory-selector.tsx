import { Folder } from 'lucide-react';
import { useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '../ui/button';

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
    console.log('Opening file dialog');
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
    <div className="flex gap-1">
      <div className="h-9 border border-border rounded-md p-2 w-full flex items-center gap-2">
        <Folder className="size-4 text-muted-foreground" />
        <p className="text-sm text-muted-foreground"> {path || placeholder}</p>
      </div>
      <Button onClick={handleOpenFileDialog} variant="outline" size="sm" className="h-9">
        Choose
      </Button>
    </div>
  );
}
