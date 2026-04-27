import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';

export type LegacyImportSource = 'v0' | 'v1-beta';

export type LegacyPortPreviewSource = {
  available: boolean;
  projects: number;
  tasks: number;
};

export type LegacyPortProjectConflict = {
  identityKey: string;
  kind: 'local' | 'ssh';
  v0: {
    name: string;
    path: string;
    taskCount: number;
    updatedAt: string | null;
  };
  v1Beta: {
    name: string;
    path: string;
    taskCount: number;
    updatedAt: string | null;
  };
};

export type LegacyPortPreview = {
  sources: {
    v0: LegacyPortPreviewSource;
    v1Beta: LegacyPortPreviewSource;
  };
  conflicts: LegacyPortProjectConflict[];
  projects: number;
  tasks: number;
};

export const LEGACY_PORT_STATUS_KEY = ['legacyPort:status'] as const;
const LEGACY_PORT_PREVIEW_KEY = ['legacyPort:preview'] as const;

export function useLegacyPortStatus() {
  return useQuery({
    queryKey: LEGACY_PORT_STATUS_KEY,
    queryFn: () => rpc.legacyPort.checkStatus(),
    staleTime: 30_000,
  });
}

export function useLegacyPortPreview(enabled: boolean) {
  return useQuery({
    queryKey: LEGACY_PORT_PREVIEW_KEY,
    queryFn: () => rpc.legacyPort.getPreview() as Promise<LegacyPortPreview>,
    enabled,
    staleTime: Infinity,
  });
}

export function useLegacyPortImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      sources: LegacyImportSource[];
      conflictChoices?: Record<string, LegacyImportSource>;
    }) => rpc.legacyPort.runImport(args),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...LEGACY_PORT_STATUS_KEY] });
    },
  });
}

export function useLegacyPortSkip() {
  const queryClient = useQueryClient();
  return useMutation({
    // run import without args skips import
    mutationFn: () => rpc.legacyPort.runImport(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...LEGACY_PORT_STATUS_KEY] });
    },
  });
}
