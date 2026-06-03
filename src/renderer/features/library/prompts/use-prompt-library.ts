import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';
import { type PromptLibrary } from '@shared/prompt-library';

const promptLibraryQueryKey = ['promptLibrary'] as const;
const emptyPromptLibrary: PromptLibrary = { folders: [], prompts: [] };

export function usePromptLibrary() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: promptLibraryQueryKey,
    queryFn: () => rpc.promptLibrary.get(),
    staleTime: 5 * 60_000,
  });

  const updateMutation = useMutation<
    void,
    Error,
    PromptLibrary,
    { previousLibrary: PromptLibrary | undefined }
  >({
    mutationFn: (library) => rpc.promptLibrary.update(library),
    onMutate: async (library) => {
      await queryClient.cancelQueries({ queryKey: promptLibraryQueryKey });
      const previousLibrary = queryClient.getQueryData<PromptLibrary>(promptLibraryQueryKey);
      queryClient.setQueryData(promptLibraryQueryKey, library);
      return { previousLibrary };
    },
    onError: (_error, _library, context) => {
      queryClient.setQueryData(promptLibraryQueryKey, context?.previousLibrary);
      void queryClient.invalidateQueries({ queryKey: promptLibraryQueryKey });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: promptLibraryQueryKey });
    },
  });

  return {
    value: data ?? emptyPromptLibrary,
    update: updateMutation.mutate,
    isLoading,
    isSaving: updateMutation.isPending,
  };
}
