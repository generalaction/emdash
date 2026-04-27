import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LegacyImportSource, LegacyPortPreview } from '@shared/legacy-port';
import { rpc } from '@renderer/lib/ipc';

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
  return useQuery<LegacyPortPreview>({
    queryKey: LEGACY_PORT_PREVIEW_KEY,
    queryFn: () => rpc.legacyPort.getPreview(),
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

export function useLegacyPortStartFresh() {
  const queryClient = useQueryClient();
  return useMutation({
    // An explicit empty source list means "start fresh".
    mutationFn: () => rpc.legacyPort.runImport({ sources: [] }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...LEGACY_PORT_STATUS_KEY] });
    },
  });
}
