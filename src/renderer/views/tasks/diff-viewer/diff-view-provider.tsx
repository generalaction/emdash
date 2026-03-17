import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext, useState } from 'react';
import type { GitChange } from '@shared/git';
import { rpc } from '@renderer/core/ipc';
import { useTaskViewContext } from '../task-view-context';

export interface CommitInfo {
  hash: string;
  subject: string;
  body: string;
  author: string;
}

interface BranchStatus {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
}

interface LatestCommit {
  hash: string;
  subject: string;
  body: string;
  isPushed: boolean;
}

interface DiffViewContextValue {
  projectId: string;
  taskId: string;

  // Changes data
  fileChanges: GitChange[];
  isLoadingChanges: boolean;
  refreshChanges: () => void;

  // Branch / latest commit
  branchStatus: BranchStatus | null;
  latestCommit: LatestCommit | null;
  refreshBranchAndCommit: () => void;

  // UI state
  activeTab: 'changes' | 'history';
  setActiveTab: (tab: 'changes' | 'history') => void;
  selectedFile: string | null;
  setSelectedFile: (path: string | null) => void;
  selectedCommit: CommitInfo | null;
  setSelectedCommit: (commit: CommitInfo | null) => void;
  selectedCommitFile: string | null;
  setSelectedCommitFile: (path: string | null) => void;
  diffStyle: 'unified' | 'split';
  setDiffStyle: (style: 'unified' | 'split') => void;
  viewMode: 'stacked' | 'file';
  setViewMode: (mode: 'stacked' | 'file') => void;

  // Git operations
  stageFile: (filePath: string) => Promise<void>;
  unstageFile: (filePath: string) => Promise<void>;
  stageAll: () => Promise<void>;
  revertFile: (filePath: string) => Promise<void>;
  commitChanges: (message: string) => Promise<{ success: boolean; error?: string }>;
  pushChanges: () => Promise<{ success: boolean; error?: string }>;
  pullChanges: () => Promise<{ success: boolean; error?: string }>;
  softResetChanges: () => Promise<{
    success: boolean;
    subject?: string;
    body?: string;
    error?: string;
  }>;
}

const DiffViewContext = createContext<DiffViewContextValue | null>(null);

function extractErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Unknown error';
}

export function DiffViewProvider({ children }: { children: ReactNode }) {
  const { task, setView } = useTaskViewContext();
  const queryClient = useQueryClient();

  const projectId = task?.projectId ?? '';
  const taskId = task?.id ?? '';
  const enabled = Boolean(task);

  // --- Queries ---

  const statusQuery = useQuery({
    queryKey: ['diff', 'status', projectId, taskId],
    queryFn: async () => {
      const result = await rpc.git.getStatus(projectId, taskId);
      if (!result.success) throw new Error(extractErrorMessage(result.error));
      const changes = (result.data?.changes ?? []) as GitChange[];
      return changes.filter((c) => !c.path.startsWith('.emdash/') && c.path !== 'PLANNING.md');
    },
    enabled,
    refetchInterval: 5000,
    staleTime: 2000,
  });

  const branchQuery = useQuery({
    queryKey: ['diff', 'branch', projectId, taskId],
    queryFn: async () => {
      const result = await rpc.git.getBranchStatus(projectId, taskId);
      if (!result.success) throw new Error(extractErrorMessage(result.error));
      return result.data as BranchStatus;
    },
    enabled,
    refetchInterval: 10000,
    staleTime: 5000,
  });

  const latestCommitQuery = useQuery({
    queryKey: ['diff', 'latest-commit', projectId, taskId],
    queryFn: async () => {
      const result = await rpc.git.getLatestCommit(projectId, taskId);
      if (!result.success) throw new Error(extractErrorMessage(result.error));
      const commit = result.data?.commit as LatestCommit | null | undefined;
      return commit ?? null;
    },
    enabled,
    refetchInterval: 10000,
    staleTime: 5000,
  });

  // --- Invalidation helpers ---

  const invalidateStatus = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['diff', 'status', projectId, taskId] });
  }, [queryClient, projectId, taskId]);

  const invalidateBranchAndCommit = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['diff', 'branch', projectId, taskId] });
    void queryClient.invalidateQueries({
      queryKey: ['diff', 'latest-commit', projectId, taskId],
    });
  }, [queryClient, projectId, taskId]);

  // --- UI state ---

  const [activeTab, setActiveTab] = useState<'changes' | 'history'>('changes');
  const [selectedFile, setSelectedFileState] = useState<string | null>(null);
  const [selectedCommit, setSelectedCommitState] = useState<CommitInfo | null>(null);
  const [selectedCommitFile, setSelectedCommitFile] = useState<string | null>(null);
  const [diffStyle, setDiffStyleState] = useState<'unified' | 'split'>(
    () => (localStorage.getItem('diffViewer:diffStyle') as 'unified' | 'split') || 'unified'
  );
  const [viewMode, setViewModeState] = useState<'stacked' | 'file'>(
    () => (localStorage.getItem('diffViewer:viewMode') as 'stacked' | 'file') || 'stacked'
  );

  const setSelectedFile = useCallback(
    (path: string | null) => {
      setSelectedFileState(path);
      if (path !== null) {
        setView('diff');
      }
    },
    [setView]
  );

  const setSelectedCommit = useCallback(
    (commit: CommitInfo | null) => {
      setSelectedCommitState(commit);
      setSelectedCommitFile(null);
      if (commit !== null) {
        setView('diff');
      }
    },
    [setView]
  );

  const setDiffStyle = useCallback((style: 'unified' | 'split') => {
    setDiffStyleState(style);
    localStorage.setItem('diffViewer:diffStyle', style);
  }, []);

  const setViewMode = useCallback((mode: 'stacked' | 'file') => {
    setViewModeState(mode);
    localStorage.setItem('diffViewer:viewMode', mode);
  }, []);

  // --- Git mutations ---

  const stageFile = useCallback(
    async (filePath: string) => {
      await rpc.git.stageFile(projectId, taskId, filePath);
      invalidateStatus();
    },
    [projectId, taskId, invalidateStatus]
  );

  const unstageFile = useCallback(
    async (filePath: string) => {
      await rpc.git.unstageFile(projectId, taskId, filePath);
      invalidateStatus();
    },
    [projectId, taskId, invalidateStatus]
  );

  const stageAll = useCallback(async () => {
    await rpc.git.stageAllFiles(projectId, taskId);
    invalidateStatus();
  }, [projectId, taskId, invalidateStatus]);

  const revertFile = useCallback(
    async (filePath: string) => {
      await rpc.git.revertFile(projectId, taskId, filePath);
      invalidateStatus();
    },
    [projectId, taskId, invalidateStatus]
  );

  const commitChanges = useCallback(
    async (message: string): Promise<{ success: boolean; error?: string }> => {
      const result = await rpc.git.commit(projectId, taskId, message);
      if (result.success) {
        invalidateStatus();
        invalidateBranchAndCommit();
        return { success: true };
      }
      return { success: false, error: extractErrorMessage(result.error) };
    },
    [projectId, taskId, invalidateStatus, invalidateBranchAndCommit]
  );

  const pushChanges = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    const result = await rpc.git.push(projectId, taskId);
    if (result.success) {
      invalidateBranchAndCommit();
      return { success: true };
    }
    return { success: false, error: extractErrorMessage(result.error) };
  }, [projectId, taskId, invalidateBranchAndCommit]);

  const pullChanges = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    const result = await rpc.git.pull(projectId, taskId);
    if (result.success) {
      invalidateStatus();
      invalidateBranchAndCommit();
      return { success: true };
    }
    return { success: false, error: extractErrorMessage(result.error) };
  }, [projectId, taskId, invalidateStatus, invalidateBranchAndCommit]);

  const softResetChanges = useCallback(async (): Promise<{
    success: boolean;
    subject?: string;
    body?: string;
    error?: string;
  }> => {
    const result = await rpc.git.softReset(projectId, taskId);
    if (result.success) {
      invalidateStatus();
      invalidateBranchAndCommit();
      const data = result.data as { subject?: string; body?: string } | undefined;
      return { success: true, subject: data?.subject, body: data?.body };
    }
    return { success: false, error: extractErrorMessage(result.error) };
  }, [projectId, taskId, invalidateStatus, invalidateBranchAndCommit]);

  return (
    <DiffViewContext.Provider
      value={{
        projectId,
        taskId,
        fileChanges: statusQuery.data ?? [],
        isLoadingChanges: statusQuery.isLoading,
        refreshChanges: invalidateStatus,
        branchStatus: branchQuery.data ?? null,
        latestCommit: latestCommitQuery.data ?? null,
        refreshBranchAndCommit: invalidateBranchAndCommit,
        activeTab,
        setActiveTab,
        selectedFile,
        setSelectedFile,
        selectedCommit,
        setSelectedCommit,
        selectedCommitFile,
        setSelectedCommitFile,
        diffStyle,
        setDiffStyle,
        viewMode,
        setViewMode,
        stageFile,
        unstageFile,
        stageAll,
        revertFile,
        commitChanges,
        pushChanges,
        pullChanges,
        softResetChanges,
      }}
    >
      {children}
    </DiffViewContext.Provider>
  );
}

export function useDiffViewContext(): DiffViewContextValue {
  const ctx = useContext(DiffViewContext);
  if (!ctx) throw new Error('useDiffViewContext must be used within DiffViewProvider');
  return ctx;
}
