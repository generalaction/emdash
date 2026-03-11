import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useContext } from 'react';
import { LocalProject, SshProject } from '@shared/projects/types';
import { useToast } from '@renderer/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';

type ProjectManagementContextValue = {
  projects: Array<LocalProject | SshProject>;
  deleteProject: (projectId: string) => void;
};

export const ProjectManagementContext = createContext<ProjectManagementContextValue | null>(null);

export function useProjectManagementContext(): ProjectManagementContextValue {
  const ctx = useContext(ProjectManagementContext);
  if (!ctx) {
    throw new Error(
      'useProjectManagementContext must be used within a ProjectManagementContext.Provider'
    );
  }
  return ctx;
}

export function ProjectManagementProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      return await rpc.projects.getProjects();
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async (projectId: string) => {
      await rpc.projects.deleteProject(projectId);
    },
    onMutate: (projectId) => {
      queryClient.setQueryData<Array<LocalProject | SshProject>>(['projects'], (old = []) =>
        old.filter((p) => p.id !== projectId)
      );
    },
    onError: (_err) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast({
        title: 'Error',
        description:
          _err instanceof Error
            ? _err.message
            : 'Could not delete project. See console for details.',
        variant: 'destructive',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const deleteProject = (projectId: string) => {
    deleteProjectMutation.mutate(projectId);
  };

  return (
    <ProjectManagementContext.Provider value={{ projects, deleteProject }}>
      {children}
    </ProjectManagementContext.Provider>
  );
}
