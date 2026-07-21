import { useQuery } from '@tanstack/react-query';
import { getTerminalsClient } from '@core/features/terminals/api/browser/client';
import type { TerminalShellAvailability } from '@core/primitives/terminals/api';

export const DEFAULT_TERMINAL_SHELL_AVAILABILITY: TerminalShellAvailability[] = [];

export function useTerminalShellAvailability(
  remoteConnectionId: string | undefined,
  options: { enabled?: boolean } = {}
) {
  const isRemote = Boolean(remoteConnectionId);
  return useQuery({
    queryKey: ['terminal-shell-availability', remoteConnectionId ?? 'local'],
    queryFn: async () => {
      const result = await (await getTerminalsClient()).getShellAvailability(undefined);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    staleTime: isRemote ? 5_000 : 30_000,
    enabled: options.enabled ?? true,
  });
}
