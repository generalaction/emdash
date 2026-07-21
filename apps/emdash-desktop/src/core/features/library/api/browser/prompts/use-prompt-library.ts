import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type PromptLibraryPrompt } from '@core/primitives/prompt-library/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';

const promptLibraryQueryKey = ['promptLibrary'] as const;

export function usePromptLibrary() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: promptLibraryQueryKey,
    queryFn: async () => (await getDesktopWireClient()).promptLibrary.get(),
    staleTime: 5 * 60_000,
  });

  const updateMutation = useMutation<
    void,
    Error,
    PromptLibraryPrompt[],
    { previousPrompts: PromptLibraryPrompt[] | undefined }
  >({
    mutationFn: async (prompts) => (await getDesktopWireClient()).promptLibrary.update({ prompts }),
    onMutate: async (prompts) => {
      await queryClient.cancelQueries({ queryKey: promptLibraryQueryKey });
      const previousPrompts =
        queryClient.getQueryData<PromptLibraryPrompt[]>(promptLibraryQueryKey);
      queryClient.setQueryData(promptLibraryQueryKey, prompts);
      return { previousPrompts };
    },
    onError: (_error, _prompts, context) => {
      queryClient.setQueryData(promptLibraryQueryKey, context?.previousPrompts);
      void queryClient.invalidateQueries({ queryKey: promptLibraryQueryKey });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: promptLibraryQueryKey });
    },
  });

  return {
    value: data ?? [],
    update: updateMutation.mutate,
    isLoading,
    isSaving: updateMutation.isPending,
  };
}
