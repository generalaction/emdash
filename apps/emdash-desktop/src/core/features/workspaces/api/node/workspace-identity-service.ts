import {
  hostRefEquals,
  hostRefFromParts,
  hostRefKey,
  sshConnectionIdOf,
  type HostRef,
} from '@emdash/core/primitives/host/api';

export type WorkspaceIdentity = Readonly<{
  workspaceId: string;
  host: HostRef;
  path: string;
  projectId: string;
}>;

export type WorkspaceHostStorage = Readonly<{
  type: 'local' | 'project-ssh';
  location: 'local' | 'remote';
  sshConnectionId: string | null;
}>;

export type WorkspaceIdentityRow = Readonly<{
  workspaceId: string;
  type: 'local' | 'project-ssh';
  location: 'local' | 'remote' | null;
  sshConnectionId: string | null;
  path: string;
  projectId: string;
}>;

export interface WorkspaceIdentitySource {
  findById(workspaceId: string): Promise<WorkspaceIdentityRow | null>;
  findRepositoryForProject(projectId: string): Promise<WorkspaceIdentityRow | null>;
  findByPath(path: string): Promise<readonly WorkspaceIdentityRow[]>;
}

/** Workspace paths and project associations are mutable; resolve them from the source each time. */
export class WorkspaceIdentityService {
  constructor(private readonly source: WorkspaceIdentitySource) {}

  async resolve(workspaceId: string): Promise<WorkspaceIdentity | null> {
    const row = await this.source.findById(workspaceId);
    return row ? identityFromRow(row) : null;
  }

  async resolveProject(projectId: string): Promise<WorkspaceIdentity | null> {
    const row = await this.source.findRepositoryForProject(projectId);
    return row ? identityFromRow(row) : null;
  }

  async findByPath(path: string, host?: HostRef): Promise<WorkspaceIdentity | null> {
    const rows = await this.source.findByPath(path);
    return selectIdentity(rows.map(identityFromRow), host);
  }
}

function identityFromRow(row: WorkspaceIdentityRow): WorkspaceIdentity {
  return {
    workspaceId: row.workspaceId,
    host: hostRefFromParts(row.location, row.sshConnectionId),
    path: row.path,
    projectId: row.projectId,
  };
}

export function workspaceHostStorage(host: HostRef): WorkspaceHostStorage {
  const sshConnectionId = sshConnectionIdOf(host);
  return sshConnectionId
    ? { type: 'project-ssh', location: 'remote', sshConnectionId }
    : { type: 'local', location: 'local', sshConnectionId: null };
}

function selectIdentity(
  identities: readonly WorkspaceIdentity[],
  host?: HostRef
): WorkspaceIdentity | null {
  const matches = host
    ? identities.filter((identity) => hostRefEquals(identity.host, host))
    : identities;
  return [...matches].sort(compareIdentities)[0] ?? null;
}

function compareIdentities(left: WorkspaceIdentity, right: WorkspaceIdentity): number {
  return (
    compareStrings(hostRefKey(left.host), hostRefKey(right.host)) ||
    compareStrings(left.workspaceId, right.workspaceId)
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
