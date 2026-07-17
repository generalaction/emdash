import { useQuery } from '@tanstack/react-query';
import type { TerminalShellAvailability } from '@core/primitives/terminals/api';
import { getTerminalTabsWireClient } from '@renderer/lib/runtime/terminal-tabs-client';

export const DEFAULT_TERMINAL_SHELL_AVAILABILITY: TerminalShellAvailability[] = [];

export function useTerminalShellAvailability(
  remoteConnectionId: string | undefined,
  options: { enabled?: boolean } = {}
) {
  const isRemote = Boolean(remoteConnectionId);
  return useQuery({
    queryKey: ['terminal-shell-availability', remoteConnectionId ?? 'local'],
    queryFn: async () => {
      const result = await (await getTerminalTabsWireClient()).getShellAvailability(undefined);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    staleTime: isRemote ? 5_000 : 30_000,
    enabled: options.enabled ?? true,
  });
}
