import { useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useContext, useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { BaseModeData, CloneModeData, ModeData, NewModeData } from './add-project-modal';

export type PendingProjectStage =
  | 'creating-repo' // GitHub API call (new mode only)
  | 'cloning' // git clone — the slow one
  | 'initializing' // README + commit + push (new mode only)
  | 'registering' // DB insert
  | 'error';

export interface PendingProject {
  id: string;
  pending: true;
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
  startNewProject: (id: string, data: NewModeData) => Promise<void>;
  startCloneProject: (id: string, data: CloneModeData) => Promise<void>;
  startPickProject: (id: string, data: BaseModeData) => Promise<void>;
};

const PendingProjectsContext = createContext<PendingProjectsContextValue | null>(null);

export function PendingProjectsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [pendingProjects, setPendingProjects] = useState<PendingProject[]>([]);

  const updatePending = (id: string, update: Partial<PendingProject>) =>
    setPendingProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...update } : p)));

  const removePending = (id: string) =>
    setPendingProjects((prev) => prev.filter((p) => p.id !== id));

  const startPickProject = async (id: string, data: BaseModeData) => {
    setPendingProjects((prev) => [
      ...prev,
      {
        id,
        name: data.name,
        mode: 'pick',
        pending: true,
        stage: 'registering',
        data: data,
      },
    ]);

    try {
      await rpc.projects.createLocalProject({ id, path: data.path, name: data.name });
      removePending(id);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    } catch (err) {
      updatePending(id, {
        stage: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  const startCloneProject = async (id: string, data: CloneModeData) => {
    setPendingProjects((prev) => [
      ...prev,
      {
        id,
        name: data.name,
        mode: 'clone',
        pending: true,
        stage: 'cloning',
        data: data,
      },
    ]);

    try {
      const result = await rpc.github.cloneRepository(
        data.repositoryUrl,
        data.path + '/' + data.name
      );
      if (!result.success) throw new Error(result.error);
      updatePending(id, { stage: 'registering' });
      await rpc.projects.createLocalProject({
        id,
        path: data.path + '/' + data.name,
        name: data.name,
      });
      removePending(id);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    } catch (err) {
      updatePending(id, {
        stage: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  const startNewProject = async (id: string, data: NewModeData) => {
    setPendingProjects((prev) => [
      ...prev,
      {
        id,
        name: data.name,
        mode: 'new',
        pending: true,
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
      updatePending(id, { stage: 'cloning' });
      const clonePath = data.path + '/' + data.name;
      const cloneResult = await rpc.github.cloneRepository(result.repoUrl, clonePath);
      if (!cloneResult.success) throw new Error(cloneResult.error);
      updatePending(id, { stage: 'registering' });
      await rpc.projects.createLocalProject({ id, path: data.path, name: data.name });
      removePending(id);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    } catch (err) {
      updatePending(id, {
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
