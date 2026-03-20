import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { GitChange, GitChangeStatus } from '@shared/git';
import { rpc } from '@renderer/core/ipc';
import { useTaskViewContext } from '../../../task-view-context';
import { useGitViewContext } from '../../state/git-view-provider';
import { ChangesListItem } from '../changes-list-item';

interface PrFilesListProps {
  nameWithOwner: string;
  prNumber: number;
  baseBranch: string;
}

interface PrFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

function toGitChange(file: PrFile): GitChange {
  return {
    path: file.filename,
    status: file.status as GitChangeStatus,
    additions: file.additions,
    deletions: file.deletions,
    isStaged: false,
  };
}

export function PrFilesList({ nameWithOwner, prNumber, baseBranch }: PrFilesListProps) {
  const { activeFile, setActiveFile, setViewMode } = useGitViewContext();
  const { projectId, taskId, setView } = useTaskViewContext();

  useQuery({
    queryKey: ['pr-fetch-origin', projectId, taskId],
    queryFn: () => rpc.git.fetch(projectId, taskId),
    staleTime: 60_000,
  });

  const remoteBase = `origin/${baseBranch}`;

  const { data: files, isLoading } = useQuery({
    queryKey: ['pr-files', nameWithOwner, prNumber],
    queryFn: async () => {
      const result = await rpc.pullRequests.getPullRequestFiles(nameWithOwner, prNumber);
      if (!result.success) throw new Error(result.error ?? 'Failed to fetch PR files');
      return result.files as PrFile[];
    },
    staleTime: 60_000,
  });

  const changes = useMemo(() => files?.map(toGitChange) ?? [], [files]);

  const handleFileClick = (change: GitChange) => {
    setActiveFile({ path: change.path, isStaged: false, baseRef: remoteBase });
    setViewMode('file');
    setView('diff');
  };

  if (isLoading || !files) {
    return <div className="p-2 text-xs text-muted-foreground">Loading files...</div>;
  }

  if (files.length === 0) {
    return <div className="p-2 text-xs text-muted-foreground">No files changed</div>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-1">
      {changes.map((change) => (
        <ChangesListItem
          key={change.path}
          change={change}
          isActive={activeFile?.path === change.path}
          onClick={() => handleFileClick(change)}
        />
      ))}
    </div>
  );
}
