import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LocalProject, SshProject } from '@shared/projects/types';
import { rpc } from '../lib/ipc';
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

  return {
    projects,
    deleteProject,
  };
};
