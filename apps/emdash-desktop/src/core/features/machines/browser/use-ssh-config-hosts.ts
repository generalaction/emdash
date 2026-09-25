import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { getMachinesStore } from '@core/features/machines/contributions/app-stores';
import type { SshConfigHost } from '@core/primitives/ssh/api';
import { formatMachineError } from './machine-form-model';
import { sshConfigTargetSchema } from './machine-form-schema';

export function useSshConfigHosts() {
  const machines = getMachinesStore();

  return useQuery({
    queryKey: ['ssh-config-hosts'],
    queryFn: () => machines.getSshConfigHosts(),
  });
}

export function useSshConfigHost(alias: string) {
  const machines = getMachinesStore();
  const trimmedAlias = alias.trim();

  return useQuery({
    queryKey: ['ssh-config-host', trimmedAlias],
    queryFn: () => machines.getSshConfigHost(trimmedAlias),
    enabled: trimmedAlias.length > 0,
  });
}

export type SshConfigResolution =
  | { status: 'choosing' }
  | { status: 'resolving'; preview?: SshConfigHost }
  | { status: 'resolved'; host: SshConfigHost; alias: string }
  | { status: 'failed'; error: string };

export function useSshConfigDraft(initialAlias = '') {
  const [target, setTarget] = useState(initialAlias);
  const [alias, setAlias] = useState(initialAlias);
  const [targetError, setTargetError] = useState<string | null>(null);
  const hosts = useSshConfigHosts();
  const query = useSshConfigHost(alias);
  let resolution: SshConfigResolution = { status: 'choosing' };
  if (targetError) resolution = { status: 'failed', error: targetError };
  else if (alias && query.isFetching) resolution = { status: 'resolving', preview: query.data };
  else if (alias && query.error)
    resolution = { status: 'failed', error: formatMachineError(query.error) };
  else if (alias && query.data) resolution = { status: 'resolved', host: query.data, alias };

  const changeTarget = (value: string) => {
    if (value === target) return;
    setTarget(value);
    setAlias('');
    setTargetError(null);
  };
  const resolve = () => {
    if (resolution.status === 'resolving') return;
    const value = target.trim();
    const parsed = sshConfigTargetSchema.safeParse(value);
    if (!parsed.success) {
      setTargetError(parsed.error.issues[0].message);
      return;
    }
    setTarget(value);
    setTargetError(null);
    if (alias === value) void query.refetch();
    else setAlias(value);
  };
  return {
    target,
    changeTarget,
    resolve,
    resolution,
    hosts: hosts.data ?? [],
    suggestionsError: hosts.error
      ? 'SSH config suggestions could not be loaded. You can still enter a hostname.'
      : null,
  };
}
