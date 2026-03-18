import { useEffect, useRef, useState } from 'react';
import { CommitFile } from '@shared/git';
import { rpc } from '@renderer/core/ipc';
import { useDiffViewContext } from './diff-view-provider';
import { splitPath } from './utils';

export function CommitFileListSection({ commitHash }: { commitHash: string }) {
  const { projectId, taskId, selectedCommitFile, setSelectedCommitFile } = useDiffViewContext();
  const [files, setFiles] = useState<CommitFile[]>([]);
  const [loading, setLoading] = useState(false);

  const setSelectedCommitFileRef = useRef(setSelectedCommitFile);
  setSelectedCommitFileRef.current = setSelectedCommitFile;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const res = await rpc.git.getCommitFiles(projectId, taskId, commitHash);
        if (!cancelled && res?.success && res.data?.files) {
          const commitFiles = res.data.files as CommitFile[];
          setFiles(commitFiles);
          if (commitFiles.length > 0 && !selectedCommitFile) {
            setSelectedCommitFileRef.current(commitFiles[0].path);
          }
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, taskId, commitHash]);

  if (loading) {
    return (
      <div className="flex h-20 items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex h-20 items-center justify-center text-sm text-muted-foreground">
        No files
      </div>
    );
  }

  return (
    <div>
      <div className="flex h-8 items-center border-b border-border px-3 text-xs font-medium text-muted-foreground">
        {files.length} changed file{files.length !== 1 ? 's' : ''}
      </div>
      {files.map((file) => {
        const { filename, directory } = splitPath(file.path);
        const dotColor =
          file.status === 'added'
            ? 'bg-green-500'
            : file.status === 'deleted'
              ? 'bg-red-500'
              : 'bg-blue-500';
        return (
          <button
            key={file.path}
            className={`w-full cursor-pointer border-b border-border/50 px-3 py-2 text-left ${
              selectedCommitFile === file.path ? 'bg-accent' : 'hover:bg-muted/50'
            }`}
            onClick={() => setSelectedCommitFile(file.path)}
          >
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dotColor}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{filename}</div>
                {directory && (
                  <div className="truncate text-xs text-muted-foreground">{directory}</div>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
