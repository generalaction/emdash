import { useQuery } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';
import type { TerminalShellAvailability } from '@shared/terminal-settings';

export const DEFAULT_TERMINAL_SHELL_AVAILABILITY: TerminalShellAvailability[] = [];

export function useTerminalShellAvailability(
  remoteConnectionId: string | undefined,
  options: { enabled?: boolean } = {}
) {
  const isRemote = Boolean(remoteConnectionId);
  return useQuery({
    queryKey: ['terminal-shell-availability', remoteConnectionId ?? 'local'],
    queryFn: () =>
      remoteConnectionId
        ? rpc.terminals.getTerminalShellAvailability({
            kind: 'ssh',
            connectionId: remoteConnectionId,
          })
        : rpc.terminals.getTerminalShellAvailability({ kind: 'local' }),
    staleTime: isRemote ? 5_000 : 30_000,
    enabled: options.enabled ?? true,
  });
}
