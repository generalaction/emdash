import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  LegacyImportSource,
  LegacyPortPreview,
} from '@core/primitives/legacy-port/api/legacy-port';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';

export const LEGACY_PORT_STATUS_KEY = ['legacyPort:status'] as const;
const LEGACY_PORT_PREVIEW_KEY = ['legacyPort:preview'] as const;

export function useLegacyPortStatus() {
  return useQuery({
    queryKey: LEGACY_PORT_STATUS_KEY,
    queryFn: async () => (await getDesktopWireClient()).legacyPort.checkStatus(),
    staleTime: 30_000,
  });
}

export function useLegacyPortPreview(enabled: boolean) {
  return useQuery<LegacyPortPreview>({
    queryKey: LEGACY_PORT_PREVIEW_KEY,
    queryFn: async () => (await getDesktopWireClient()).legacyPort.getPreview(),
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
    }) => getDesktopWireClient().then((client) => client.legacyPort.runImport(args)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...LEGACY_PORT_STATUS_KEY] });
    },
  });
}

export function useLegacyPortStartFresh() {
  const queryClient = useQueryClient();
  return useMutation({
    // An explicit empty source list means "start fresh".
    mutationFn: async () => (await getDesktopWireClient()).legacyPort.runImport({ sources: [] }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...LEGACY_PORT_STATUS_KEY] });
    },
  });
}
