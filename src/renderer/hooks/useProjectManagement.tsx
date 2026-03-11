import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '../lib/ipc';
import type { Project } from '../types/app';
import { useToast } from './use-toast';

export const useProjectManagement = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      return await rpc.projects.getProjects();
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const addLocalProjectMutation = useMutation({
    mutationFn: async ({ path, name }: { path: string; name: string }) => {
      const result = await rpc.projects.createLocalProject({ path, name });
      return result;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  const addRemoteProjectMutation = useMutation({
    mutationFn: async ({
      connectionId,
      path,
      name,
    }: {
      connectionId: string;
      path: string;
      name: string;
    }) => {
      const result = await rpc.projects.createSshProject({ connectionId, path, name });
      return result;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async (projectId: string) => {
      await rpc.projects.deleteProject(projectId);
    },
    onMutate: (projectId) => {
      queryClient.setQueryData<Project[]>(['projects'], (old = []) =>
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

  const addLocalProject = ({ path, name }: { path: string; name: string }) => {
    addLocalProjectMutation.mutate({ path, name });
  };

  const addRemoteProject = ({
    connectionId,
    path,
    name,
  }: {
    connectionId: string;
    path: string;
    name: string;
  }) => {
    addRemoteProjectMutation.mutate({ connectionId, path, name });
  };

  return {
    projects,
    deleteProject,
    addLocalProject,
    addRemoteProject,
  };
};
