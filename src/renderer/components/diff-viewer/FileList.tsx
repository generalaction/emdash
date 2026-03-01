import React, { useState } from 'react';
import { Undo2 } from 'lucide-react';
import { Checkbox } from '../ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import type { FileChange } from '../../hooks/useFileChanges';

interface FileListProps {
  fileChanges: FileChange[];
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
  taskPath?: string;
  onRefreshChanges?: () => Promise<void> | void;
}

export const FileList: React.FC<FileListProps> = ({
  fileChanges,
  selectedFile,
  onSelectFile,
  taskPath,
  onRefreshChanges,
}) => {
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);

  const tracked = fileChanges
    .filter((f) => f.status !== 'added')
    .sort((a, b) => a.path.localeCompare(b.path));
  const untracked = fileChanges
    .filter((f) => f.status === 'added')
    .sort((a, b) => a.path.localeCompare(b.path));

  const allStaged = fileChanges.length > 0 && fileChanges.every((f) => f.isStaged);
  const trackedAllStaged = tracked.length > 0 && tracked.every((f) => f.isStaged);
  const untrackedAllStaged = untracked.length > 0 && untracked.every((f) => f.isStaged);

  const handleStageAll = async (checked: boolean) => {
    if (!taskPath) return;
    try {
      if (checked) {
        await window.electronAPI.stageAllFiles({ taskPath });
      } else {
        await Promise.all(
          fileChanges
            .filter((f) => f.isStaged)
            .map((f) => window.electronAPI.unstageFile({ taskPath, filePath: f.path }))
        );
      }
    } catch (err) {
      console.error('Staging failed:', err);
    }
    await onRefreshChanges?.();
  };

  const handleGroupStage = async (files: FileChange[], checked: boolean) => {
    if (!taskPath) return;
    try {
      await Promise.all(
        files.map((file) => {
          if (checked && !file.isStaged) {
            return window.electronAPI.stageFile({ taskPath, filePath: file.path });
          } else if (!checked && file.isStaged) {
            return window.electronAPI.unstageFile({ taskPath, filePath: file.path });
          }
          return Promise.resolve();
        })
      );
    } catch (err) {
      console.error('Staging failed:', err);
    }
    await onRefreshChanges?.();
  };

  const handleFileStage = async (filePath: string, checked: boolean) => {
    if (!taskPath) return;
    try {
      if (checked) {
        await window.electronAPI.stageFile({ taskPath, filePath });
      } else {
        await window.electronAPI.unstageFile({ taskPath, filePath });
      }
    } catch (err) {
      console.error('Staging failed:', err);
    }
    await onRefreshChanges?.();
  };

  const executeRestore = async () => {
    if (!taskPath || !restoreTarget) return;
    try {
      await window.electronAPI.revertFile({ taskPath, filePath: restoreTarget });
      setRestoreTarget(null);
      await onRefreshChanges?.();
    } catch (err) {
      console.error('Restore failed:', err);
      setRestoreTarget(null);
    }
  };

  const renderFileRow = (file: FileChange, dotColor: string) => {
    const parts = file.path.split('/');
    const filename = parts.pop() || file.path;
    const directory = parts.length > 0 ? parts.join('/') + '/' : '';

    return (
      <div
        key={file.path}
        className={`group/file flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-accent/50 ${
          selectedFile === file.path ? 'bg-accent' : ''
        }`}
        onClick={() => onSelectFile(file.path)}
      >
        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dotColor}`} />
        <div className="min-w-0 flex-1 truncate">
          <span className="font-medium text-foreground">{filename}</span>
          {directory && <span className="ml-1 text-muted-foreground">{directory}</span>}
        </div>
        <button
          className="flex-shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/file:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            setRestoreTarget(file.path);
          }}
          title="Restore file"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <Checkbox
          checked={file.isStaged}
          onCheckedChange={(checked) => {
            void handleFileStage(file.path, checked === true);
          }}
          onClick={(e) => e.stopPropagation()}
          className={`flex-shrink-0 transition-opacity ${file.isStaged ? '' : 'opacity-0 group-hover/file:opacity-100'}`}
        />
      </div>
    );
  };

  if (fileChanges.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
        No changes
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col">
        {/* Stage All */}
        <div className="flex h-9 items-center gap-2 border-b border-border px-3">
          <Checkbox
            checked={allStaged}
            onCheckedChange={(checked) => void handleStageAll(checked === true)}
          />
          <span className="text-xs font-medium text-muted-foreground">Stage All</span>
        </div>

        {/* Tracked files */}
        {tracked.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center gap-2 px-3 py-1.5">
              <Checkbox
                checked={trackedAllStaged}
                onCheckedChange={(checked) => void handleGroupStage(tracked, checked === true)}
              />
              <span className="text-xs font-medium tracking-wide text-muted-foreground">
                Tracked
              </span>
              <span className="text-xs text-muted-foreground">({tracked.length})</span>
            </div>
            {tracked.map((file) => renderFileRow(file, 'bg-blue-500'))}
          </div>
        )}

        {/* Untracked files */}
        {untracked.length > 0 && (
          <div className={tracked.length > 0 ? 'mt-3 pt-1' : ''}>
            <div className="flex items-center gap-2 px-3 py-1.5">
              <Checkbox
                checked={untrackedAllStaged}
                onCheckedChange={(checked) => void handleGroupStage(untracked, checked === true)}
              />
              <span className="text-xs font-medium tracking-wide text-muted-foreground">
                Untracked
              </span>
              <span className="text-xs text-muted-foreground">({untracked.length})</span>
            </div>
            {untracked.map((file) => renderFileRow(file, 'bg-green-500'))}
          </div>
        )}
      </div>

      <AlertDialog open={!!restoreTarget} onOpenChange={(open) => !open && setRestoreTarget(null)}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg">Restore file?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription className="text-sm">
            This will discard all uncommitted changes to{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              {restoreTarget?.split('/').pop()}
            </code>{' '}
            and restore it to the last committed version. This action cannot be undone.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void executeRestore()}
              className="bg-destructive px-4 py-2 text-destructive-foreground hover:bg-destructive/90"
            >
              <Undo2 className="mr-2 h-4 w-4" />
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
