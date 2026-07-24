import type { WorkspaceServerLayout } from './layout';

export type LocalWorkspaceServerTarget = {
  kind: 'local-socket';
  socketPath: string;
};

export type SshWorkspaceServerTarget = {
  kind: 'ssh';
  sshConnectionId: string;
  socketPath: string;
};

export type WorkspaceServerTarget = LocalWorkspaceServerTarget | SshWorkspaceServerTarget;

export function sshWorkspaceServerTarget(
  sshConnectionId: string,
  layout: WorkspaceServerLayout
): SshWorkspaceServerTarget {
  return {
    kind: 'ssh',
    sshConnectionId,
    socketPath: layout.socketPath,
  };
}

export function workspaceServerTargetKey(target: WorkspaceServerTarget): string {
  switch (target.kind) {
    case 'local-socket':
      return `${target.kind}\0${target.socketPath}`;
    case 'ssh':
      return `${target.kind}\0${target.sshConnectionId}\0${target.socketPath}`;
  }
}
