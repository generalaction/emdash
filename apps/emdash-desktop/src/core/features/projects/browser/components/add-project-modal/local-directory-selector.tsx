import { Folder } from 'lucide-react';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { cn } from '@core/primitives/ui/browser/cn';
import { rpc } from '@renderer/lib/runtime/desktop-host-client';
import { type Strategy } from './add-project-modal';
import { type ProjectDirectoryPickerClient } from './project-directory-picker';

interface DirectoryFieldProps {
  strategy: Strategy;
  connectionId?: string;
  title: string;
  message: string;
  path?: string;
  getProjectsClient(): Promise<ProjectDirectoryPickerClient>;
  onPathChange: (path: string) => void;
  placeholder?: string;
}

export function DirectoryField({
  strategy,
  connectionId,
  title,
  message,
  onPathChange,
  path = '',
  getProjectsClient,
  placeholder = 'Select a directory',
}: DirectoryFieldProps) {
  const openDirectorySelectorModal = useOpenModal('directorySelectorModal');
  const disabled = strategy === 'ssh' && !connectionId;

  const handleChooseDirectory = async () => {
    if (strategy === 'ssh') {
      if (!connectionId) return;
      const outcome = await openDirectorySelectorModal({
        connectionId,
        initialPath: path || undefined,
        getProjectsClient,
      });
      if (outcome.success) onPathChange(outcome.data.path);
      return;
    }

    const result = await rpc.app.openSelectDirectoryDialog({
      title,
      message,
    });
    if (result) {
      onPathChange(result);
    }
  };

  return (
    <button
      type="button"
      className={cn(
        'flex h-9 w-full items-center gap-2 rounded-md border border-border p-2 pr-1.5 transition-colors hover:bg-background-quaternary-1 disabled:cursor-not-allowed disabled:opacity-60',
        disabled ? '' : 'cursor-pointer'
      )}
      disabled={disabled}
      onClick={() => void handleChooseDirectory()}
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
      <span className="inline-flex h-6 shrink-0 items-center justify-center rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground transition-colors">
        Choose
      </span>
    </button>
  );
}
