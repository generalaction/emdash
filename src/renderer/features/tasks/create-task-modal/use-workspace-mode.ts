import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import type { WorktreeEntry } from '@shared/workspaces';

export type WorkspaceMode = 'new' | 'existing';
export type WorkspaceModeState = ReturnType<typeof useWorkspaceMode>;

export function useWorkspaceMode(projectId: string | undefined) {
  const [mode, setMode] = useState<WorkspaceMode>('new');
  const [selectedEntry, setSelectedEntry] = useState<WorktreeEntry | null>(null);

  // Reset when project changes.
  const [prevProjectId, setPrevProjectId] = useState(projectId);
  if (projectId !== prevProjectId) {
    setPrevProjectId(projectId);
    setMode('new');
    setSelectedEntry(null);
  }

  const { data: worktrees, isPending } = useQuery({
    queryKey: ['listWorktrees', projectId],
    queryFn: () => rpc.projects.listWorktrees(projectId!),
    enabled: !!projectId && mode === 'existing',
    refetchOnWindowFocus: false,
  });

  // Wrap setMode to also clear the selected entry on mode change.
  const changeMode = (m: WorkspaceMode) => {
    setMode(m);
    setSelectedEntry(null);
  };

  const isValid = mode === 'new' || selectedEntry !== null;

  return { mode, setMode: changeMode, selectedEntry, setSelectedEntry, worktrees, isPending, isValid };
}
