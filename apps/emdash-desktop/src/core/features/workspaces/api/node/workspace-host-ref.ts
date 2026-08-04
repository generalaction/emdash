import { hostRef, LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';

export type WorkspaceHostRefRow = Readonly<{
  location: 'local' | 'remote' | null;
  sshConnectionId: string | null;
}>;

export function hostRefFromWorkspaceRow(row: WorkspaceHostRefRow): HostRef {
  if (row.location === 'local') return LOCAL_HOST_REF;
  if (row.location === 'remote') {
    if (!row.sshConnectionId) {
      throw new Error('Remote workspace row has no SSH connection.');
    }
    return hostRef('remote', row.sshConnectionId);
  }
  throw new Error('Workspace row has no location.');
}
