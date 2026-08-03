import { encodeResourceKeyPart, hostResourceKey } from '@primitives/host-resource/api';
import { defineResource } from '@primitives/kernel/api';

export interface HostResourceRef {
  hostRef: string;
}

export interface RepoResourceRef extends HostResourceRef {
  repoPath: string;
}

export interface WorktreeResourceRef extends RepoResourceRef {
  worktreePath: string;
}

export interface BranchResourceRef extends RepoResourceRef {
  branchName: string;
}

export const hostKernelResource = defineResource<'host', HostResourceRef>({
  name: 'host',
  key: (ref) => `host:${encodeResourceKeyPart(ref.hostRef)}`,
});

export const repoKernelResource = defineResource<'repo', RepoResourceRef>({
  name: 'repo',
  key: (ref) => hostResourceKey({ kind: 'repo', hostId: ref.hostRef, path: ref.repoPath }),
  parent: (ref) => ({ def: hostKernelResource, ref: { hostRef: ref.hostRef } }),
});

export const worktreeKernelResource = defineResource<'worktree', WorktreeResourceRef>({
  name: 'worktree',
  key: (ref) => hostResourceKey({ kind: 'worktree', hostId: ref.hostRef, path: ref.worktreePath }),
  parent: (ref) => ({
    def: repoKernelResource,
    ref: { hostRef: ref.hostRef, repoPath: ref.repoPath },
  }),
});

export const branchKernelResource = defineResource<'branch', BranchResourceRef>({
  name: 'branch',
  key: (ref) =>
    hostResourceKey({
      kind: 'branch',
      hostId: ref.hostRef,
      repoPath: ref.repoPath,
      branchName: ref.branchName,
    }),
  parent: (ref) => ({
    def: repoKernelResource,
    ref: { hostRef: ref.hostRef, repoPath: ref.repoPath },
  }),
});
