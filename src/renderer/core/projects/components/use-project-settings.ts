import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectSettings } from '@main/core/projects/settings/schema';
import { rpc } from '@renderer/core/ipc';

export function projectSettingsQueryKey(projectId: string) {
  return ['project', 'settings', projectId] as const;
}

export function useProjectSettings(projectId: string) {
  const queryClient = useQueryClient();
  const queryKey = projectSettingsQueryKey(projectId);

  const { data: settings, isLoading } = useQuery({
    queryKey,
    queryFn: () => rpc.projects.getProjectSettings(projectId),
  });

  const mutation = useMutation<void, Error, ProjectSettings>({
    mutationFn: (updated) => rpc.projects.updateProjectSettings(projectId, updated),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['repository', 'defaultBranch', projectId] });
    },
  });

  return {
    settings,
    isLoading,
    save: mutation.mutateAsync,
    isSaving: mutation.isPending,
    error: mutation.error,
  };
}
