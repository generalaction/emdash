import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext, useMemo } from 'react';
import { GitChange } from '@shared/git';
import { rpc } from '@renderer/core/ipc';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { extractErrorMessage } from './utils';

interface GitChangesContextValue {
  fileChanges: GitChange[];
  stagedFileChanges: GitChange[];
  unstagedFileChanges: GitChange[];
  totalFilesChanged: number;
  totalLinesAdded: number;
  totalLinesDeleted: number;
  isLoading: boolean;
  discardAllChanges: () => Promise<void>;
  discardFilesChanges: (filePaths: string[]) => Promise<void>;
  stageAllChanges: () => Promise<void>;
  stageFilesChanges: (filePaths: string[]) => Promise<void>;
  unstageAllChanges: () => Promise<void>;
  unstageFilesChanges: (filePaths: string[]) => Promise<void>;
  commitChanges: (message: string) => Promise<void>;
}

const GitChangesContext = createContext<GitChangesContextValue | null>(null);

export function GitChangesProvider({
  children,
  projectId,
  taskId,
}: {
  children: ReactNode;
  projectId: string;
  taskId: string;
}) {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ['git', 'changes', projectId, taskId],
    queryFn: async () => {
      const result = await rpc.git.getStatus(projectId, taskId);
      if (!result.success) throw new Error(extractErrorMessage(result.error));
      return result.data?.changes ?? ([] as GitChange[]);
    },
  });

  const showConfirmActionModal = useShowModal('confirmActionModal');

  const isLoading = statusQuery.isLoading;
  const fileChanges = useMemo(() => statusQuery.data ?? ([] as GitChange[]), [statusQuery.data]);

  const totalFilesChanged = fileChanges.length;

  const totalLinesAdded = useMemo(
    () => fileChanges.reduce((sum, c) => sum + (c.additions ?? 0), 0),
    [fileChanges]
  );
  const totalLinesDeleted = useMemo(
    () => fileChanges.reduce((sum, c) => sum + (c.deletions ?? 0), 0),
    [fileChanges]
  );

  const stagedFileChanges = useMemo(() => fileChanges.filter((c) => c.isStaged), [fileChanges]);
  const unstagedFileChanges = useMemo(() => fileChanges.filter((c) => !c.isStaged), [fileChanges]);

  const discardAllChanges = useCallback(async () => {
    showConfirmActionModal({
      title: 'Discard All Changes',
      variant: 'destructive',
      description: 'Are you sure you want to discard all changes? This can not be undone.',
      onSuccess: async () => {
        await rpc.git.revertAllFiles(projectId, taskId);
        queryClient.invalidateQueries({ queryKey: ['git', 'changes', projectId, taskId] });
      },
    });
  }, [projectId, taskId, queryClient, showConfirmActionModal]);

  const discardFilesChanges = useCallback(
    async (filePaths: string[]) => {
      showConfirmActionModal({
        title: 'Discard Files Changes',
        variant: 'destructive',
        description:
          'Are you sure you want to discard the changes to the selected files? This can not be undone.',
        onSuccess: async () => {
          await rpc.git.revertFiles(projectId, taskId, filePaths);
          queryClient.invalidateQueries({ queryKey: ['git', 'changes', projectId, taskId] });
        },
      });
    },
    [projectId, taskId, queryClient, showConfirmActionModal]
  );

  const stageAllChanges = useCallback(async () => {
    await rpc.git.stageAllFiles(projectId, taskId);
    queryClient.invalidateQueries({ queryKey: ['git', 'changes', projectId, taskId] });
  }, [projectId, taskId, queryClient]);

  const stageFilesChanges = useCallback(
    async (filePaths: string[]) => {
      await rpc.git.stageFiles(projectId, taskId, filePaths);
      void queryClient.invalidateQueries({ queryKey: ['git', 'changes', projectId, taskId] });
    },
    [projectId, taskId, queryClient]
  );

  const unstageAllChanges = useCallback(async () => {
    await rpc.git.unstageAllFiles(projectId, taskId);
    void queryClient.invalidateQueries({ queryKey: ['git', 'changes', projectId, taskId] });
  }, [projectId, taskId, queryClient]);

  const unstageFilesChanges = useCallback(
    async (filePaths: string[]) => {
      await rpc.git.unstageFiles(projectId, taskId, filePaths);
      void queryClient.invalidateQueries({ queryKey: ['git', 'changes', projectId, taskId] });
    },
    [projectId, taskId, queryClient]
  );

  const commitChanges = useCallback(
    async (message: string) => {
      const result = await rpc.git.commit(projectId, taskId, message);
      if (!result.success) throw new Error(extractErrorMessage(result.error));
      void queryClient.invalidateQueries({ queryKey: ['git', 'changes', projectId, taskId] });
    },
    [projectId, taskId, queryClient]
  );

  return (
    <GitChangesContext.Provider
      value={{
        fileChanges,
        totalFilesChanged,
        totalLinesAdded,
        totalLinesDeleted,
        stagedFileChanges,
        unstagedFileChanges,
        isLoading,
        discardAllChanges,
        discardFilesChanges,
        stageAllChanges,
        stageFilesChanges,
        commitChanges,
        unstageAllChanges,
        unstageFilesChanges,
      }}
    >
      {children}
    </GitChangesContext.Provider>
  );
}

export function useGitChangesContext() {
  const ctx = useContext(GitChangesContext);
  if (!ctx) throw new Error('useGitChangesContext must be used within GitChangesProvider');
  return ctx;
}
