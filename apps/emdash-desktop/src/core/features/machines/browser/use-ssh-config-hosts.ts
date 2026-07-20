import { useQuery } from '@tanstack/react-query';
import { appState } from '@renderer/lib/stores/app-state';

export function useSshConfigHosts() {
  const machines = appState.machines;

  return useQuery({
    queryKey: ['ssh-config-hosts'],
    queryFn: () => machines.getSshConfigHosts(),
  });
}

export function useSshConfigHost(alias: string) {
  const machines = appState.machines;
  const trimmedAlias = alias.trim();

  return useQuery({
    queryKey: ['ssh-config-host', trimmedAlias],
    queryFn: () => machines.getSshConfigHost(trimmedAlias),
    enabled: trimmedAlias.length > 0,
  });
}
