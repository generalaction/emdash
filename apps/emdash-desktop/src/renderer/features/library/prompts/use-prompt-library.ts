import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { type PromptLibraryState } from '@shared/prompt-library';

const promptLibraryQueryKey = ['promptLibrary'] as const;

const EMPTY_STATE: PromptLibraryState = { prompts: [], folders: [] };

export function usePromptLibrary() {
  const queryClient = useQueryClient();
  const prewrittenPreviousState = useRef<{ state: PromptLibraryState | undefined } | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: promptLibraryQueryKey,
    queryFn: () => rpc.promptLibrary.get(),
    staleTime: 5 * 60_000,
  });

  const updateMutation = useMutation<
    void,
    Error,
    PromptLibraryState,
    { previousState: PromptLibraryState | undefined }
  >({
    mutationFn: (state) => rpc.promptLibrary.update(state),
    onMutate: async (state) => {
      await queryClient.cancelQueries({ queryKey: promptLibraryQueryKey });
      const previousState =
        prewrittenPreviousState.current?.state ??
        queryClient.getQueryData<PromptLibraryState>(promptLibraryQueryKey);
      prewrittenPreviousState.current = null;
      queryClient.setQueryData(promptLibraryQueryKey, state);
      return { previousState };
    },
    onError: (_error, _state, context) => {
      queryClient.setQueryData(promptLibraryQueryKey, context?.previousState);
      void queryClient.invalidateQueries({ queryKey: promptLibraryQueryKey });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: promptLibraryQueryKey });
    },
  });

  // Sets the cache before mutating so the cache already holds the new order
  // when the caller's drop-time local state is cleared. Keep the true prior
  // state so mutation errors can roll back immediately instead of waiting for
  // invalidateQueries to refetch.
  const reorder: typeof updateMutation.mutate = (state, options) => {
    prewrittenPreviousState.current = {
      state: queryClient.getQueryData<PromptLibraryState>(promptLibraryQueryKey),
    };
    queryClient.setQueryData(promptLibraryQueryKey, state);
    updateMutation.mutate(state, options);
  };

  const state = data ?? EMPTY_STATE;

  return {
    prompts: state.prompts,
    folders: state.folders,
    update: updateMutation.mutate,
    reorder,
    isLoading,
    isSaving: updateMutation.isPending,
  };
}
