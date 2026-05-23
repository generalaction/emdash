import { useQuery } from '@tanstack/react-query';
import { appState } from '@renderer/lib/stores/app-state';

export function useSshConfigHosts() {
  const sshConnections = appState.sshConnections;

  return useQuery({
    queryKey: ['ssh-config-hosts'],
    queryFn: () => sshConnections.getSshConfigHosts(),
  });
}

export function useSshConfigHost(alias: string) {
  const sshConnections = appState.sshConnections;
  const trimmedAlias = alias.trim();

  return useQuery({
    queryKey: ['ssh-config-host', trimmedAlias],
    queryFn: () => sshConnections.getSshConfigHost(trimmedAlias),
    enabled: trimmedAlias.length > 0,
  });
}

export function useDefaultPrivateKeyPath() {
  const sshConnections = appState.sshConnections;

  return useQuery({
    queryKey: ['default-private-key-path'],
    queryFn: () => sshConnections.getDefaultPrivateKeyPath(),
    staleTime: Infinity,
  });
}
