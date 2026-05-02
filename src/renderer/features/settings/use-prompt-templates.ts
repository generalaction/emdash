import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreatePromptTemplateInput,
  PromptTemplate,
  UpdatePromptTemplateInput,
} from '@shared/prompt-templates';
import { rpc } from '@renderer/lib/ipc';

export function usePromptTemplates() {
  const queryClient = useQueryClient();

  const { data: templates = [], isLoading } = useQuery<PromptTemplate[]>({
    queryKey: ['promptTemplates'] as const,
    queryFn: () => rpc.promptTemplates.list() as Promise<PromptTemplate[]>,
    staleTime: 30_000,
  });

  const createMutation = useMutation<PromptTemplate, Error, CreatePromptTemplateInput>({
    mutationFn: (input) => rpc.promptTemplates.create(input) as Promise<PromptTemplate>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promptTemplates'] });
    },
  });

  const updateMutation = useMutation<
    PromptTemplate,
    Error,
    { id: string; input: UpdatePromptTemplateInput }
  >({
    mutationFn: ({ id, input }) => rpc.promptTemplates.update(id, input) as Promise<PromptTemplate>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promptTemplates'] });
    },
  });

  const deleteMutation = useMutation<void, Error, string>({
    mutationFn: (id) => rpc.promptTemplates.delete(id) as Promise<void>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promptTemplates'] });
    },
  });

  const reorderMutation = useMutation<void, Error, string[]>({
    mutationFn: (ids) => rpc.promptTemplates.reorder(ids) as Promise<void>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promptTemplates'] });
    },
  });

  return {
    templates,
    isLoading,
    isSaving:
      createMutation.isPending ||
      updateMutation.isPending ||
      deleteMutation.isPending ||
      reorderMutation.isPending,
    create: createMutation.mutate,
    update: updateMutation.mutate,
    delete: deleteMutation.mutate,
    reorder: reorderMutation.mutate,
  };
}
