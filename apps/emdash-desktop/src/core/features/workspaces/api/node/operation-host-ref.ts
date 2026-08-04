import {
  hostRef,
  hostRefFromParts,
  LOCAL_HOST_REF,
  type HostRef,
} from '@emdash/core/primitives/host/api';

type WorkspaceHostColumns = {
  location?: 'local' | 'remote' | null;
  sshConnectionId?: string | null;
};

type ProjectHostColumns = {
  sshConnectionId?: string | null;
};

/** Resolves operation routing from the most authoritative available owner. */
export function operationHostRef(input: {
  workspace?: WorkspaceHostColumns;
  project?: ProjectHostColumns;
}): HostRef {
  const workspace = input.workspace;
  if (workspace?.location) {
    return hostRefFromParts(workspace.location, workspace.sshConnectionId ?? null);
  }
  if (workspace?.sshConnectionId) return hostRef('remote', workspace.sshConnectionId);
  if (input.project?.sshConnectionId) return hostRef('remote', input.project.sshConnectionId);
  return LOCAL_HOST_REF;
}
