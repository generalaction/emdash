import React, { useEffect, useRef, useState } from 'react';
import { splitPath } from './pathUtils';

interface CommitFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

interface CommitFileListProps {
  taskPath?: string;
  commitHash: string;
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
}

export const CommitFileList: React.FC<CommitFileListProps> = ({
  taskPath,
  commitHash,
  selectedFile,
  onSelectFile,
}) => {
  const [files, setFiles] = useState<CommitFile[]>([]);
  const [loading, setLoading] = useState(false);

  const onSelectFileRef = useRef(onSelectFile);
  onSelectFileRef.current = onSelectFile;

  useEffect(() => {
    if (!taskPath || !commitHash) {
      setFiles([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const res = await window.electronAPI.gitGetCommitFiles({ taskPath, commitHash });
        if (!cancelled && res?.success && res.files) {
          setFiles(res.files);
          // Auto-select the first file
          if (res.files.length > 0) {
            onSelectFileRef.current(res.files[0].path);
          }
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
    // Intentionally only re-run on taskPath/commitHash change. onSelectFile is excluded
    // to avoid re-fetching when the parent re-renders with a new callback reference.
  }, [taskPath, commitHash]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No files
      </div>
    );
  }

  return (
    <div className="overflow-y-auto">
      <div className="flex h-9 items-center border-b border-border px-3 text-sm font-medium text-muted-foreground">
        {files.length} changed file{files.length !== 1 ? 's' : ''}
      </div>
      {files.map((file) => {
        const { filename, directory } = splitPath(file.path);
        return (
          <button
            key={file.path}
            className={`w-full cursor-pointer border-b border-border/50 px-3 py-2 text-left ${
              selectedFile === file.path ? 'bg-accent' : 'hover:bg-muted/50'
            }`}
            onClick={() => onSelectFile(file.path)}
          >
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{filename}</div>
                {directory && (
                  <div className="truncate text-xs text-muted-foreground">{directory}</div>
                )}
              </div>
              <span
                className={`h-2 w-2 flex-shrink-0 rounded-full ${
                  file.status === 'added'
                    ? 'bg-green-500'
                    : file.status === 'deleted'
                      ? 'bg-red-500'
                      : 'bg-blue-500'
                }`}
                title={file.status}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
};
