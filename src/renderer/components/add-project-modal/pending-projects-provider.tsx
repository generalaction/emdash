import { useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useContext, useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { BaseModeData, CloneModeData, ModeData, NewModeData } from './add-project-modal';

type PendingProjectStage =
  | 'creating-repo' // GitHub API call (new mode only)
  | 'cloning' // git clone — the slow one
  | 'initializing' // README + commit + push (new mode only)
  | 'registering' // DB insert
  | 'error';

interface PendingProject {
  id: string;
  name: string;
  mode: 'new' | 'clone' | 'pick';
  data: ModeData;
  stage: PendingProjectStage;
  error?: string;
}

export type PendingProjectsContextValue = {
  pendingProjects: PendingProject[];
  updatePending: (id: string, update: Partial<PendingProject>) => void;
  removePending: (id: string) => void;
  startNewProject: (data: NewModeData) => Promise<void>;
  startCloneProject: (data: CloneModeData) => Promise<void>;
  startPickProject: (data: BaseModeData) => Promise<void>;
};

const PendingProjectsContext = createContext<PendingProjectsContextValue | null>(null);

export function PendingProjectsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [pendingProjects, setPendingProjects] = useState<PendingProject[]>([]);

  const updatePending = (id: string, update: Partial<PendingProject>) =>
    setPendingProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...update } : p)));

  const removePending = (id: string) =>
    setPendingProjects((prev) => prev.filter((p) => p.id !== id));

  const startPickProject = async (data: BaseModeData) => {
    const pendingId = crypto.randomUUID();

    setPendingProjects((prev) => [
      ...prev,
      {
        id: pendingId,
        name: data.name,
        mode: 'pick',
        stage: 'registering',
        data: data,
      },
    ]);

    try {
      await rpc.projects.createLocalProject({ path: data.path, name: data.name });
      updatePending(pendingId, { stage: 'registering' });
      removePending(pendingId);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    } catch (err) {
      updatePending(pendingId, {
        stage: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  const startCloneProject = async (data: CloneModeData) => {
    const pendingId = crypto.randomUUID();

    setPendingProjects((prev) => [
      ...prev,
      {
        id: pendingId,
        name: data.name,
        mode: 'clone',
        stage: 'cloning',
        data: data,
      },
    ]);

    try {
      const result = await rpc.github.cloneRepository(data.repositoryUrl, data.path);
      if (!result.success) throw new Error(result.error);
      updatePending(pendingId, { stage: 'registering' });
      await rpc.projects.createLocalProject({ path: data.path, name: data.name });
      removePending(pendingId);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    } catch (err) {
      updatePending(pendingId, {
        stage: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  const startNewProject = async (data: NewModeData) => {
    const pendingId = crypto.randomUUID();
    setPendingProjects((prev) => [
      ...prev,
      {
        id: pendingId,
        name: data.name,
        mode: 'new',
        stage: 'creating-repo',
        data: data,
      },
    ]);

    try {
      const result = await rpc.github.createNewProject({
        name: data.repositoryName,
        owner: data.repositoryOwner,
        isPrivate: data.repositoryVisibility === 'private',
      });
      if (!result.success || !result.repoUrl) throw new Error(result.error);
      updatePending(pendingId, { stage: 'cloning' });
      const cloneResult = await rpc.github.cloneRepository(result.repoUrl, data.path);
      if (!cloneResult.success) throw new Error(cloneResult.error);
      updatePending(pendingId, { stage: 'registering' });
      await rpc.projects.createLocalProject({ path: data.path, name: data.name });
      removePending(pendingId);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    } catch (err) {
      updatePending(pendingId, {
        stage: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  return (
    <PendingProjectsContext.Provider
      value={{
        pendingProjects,
        updatePending,
        removePending,
        startNewProject,
        startCloneProject,
        startPickProject,
      }}
    >
      {children}
    </PendingProjectsContext.Provider>
  );
}

export function usePendingProjectsContext() {
  const context = useContext(PendingProjectsContext);
  if (!context) {
    throw new Error('usePendingProjectsContext must be used within a PendingProjectsProvider');
  }
  return context;
}
