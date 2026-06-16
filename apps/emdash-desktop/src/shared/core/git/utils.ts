import type { GitBranchRef, GitObjectRef, GitRemote, MergeBaseRange } from '@emdash/shared/git';
import type { ProjectSettings } from '../project-settings/project-settings';
import { DEFAULT_REMOTE_NAME, type ConfiguredRemotes, type GitRef } from './types';

export function toRangeString(range: MergeBaseRange): string {
  return `${toRefString(range.base)}...${toRefString(range.head)}`;
}

export function mergeBaseRange(base: GitObjectRef, head: GitObjectRef): MergeBaseRange {
  return { base, head };
}

export function toRefString(ref: GitObjectRef): string {
  switch (ref.kind) {
    case 'branch':
      return ref.branch.type === 'remote'
        ? `${ref.branch.remote.name}/${ref.branch.branch}`
        : ref.branch.branch;
    case 'commit':
      return ref.sha;
    case 'tag':
      return ref.name;
  }
}

export function gitRefToString(ref: GitRef): string {
  if (ref.kind === 'head') return 'HEAD';
  if (ref.kind === 'staged') return 'STAGED';
  return toRefString(ref);
}

export function refsEqual(a: GitRef, b: GitRef): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'head':
    case 'staged':
      return true;
    case 'branch': {
      const ab = a.branch;
      const bb = (b as typeof a).branch;
      if (ab.type !== bb.type) return false;
      if (ab.type === 'remote' && bb.type === 'remote') {
        return ab.remote.name === bb.remote.name && ab.branch === bb.branch;
      }
      return ab.branch === bb.branch;
    }
    case 'commit':
      return a.sha === (b as typeof a).sha;
    case 'tag':
      return a.name === (b as typeof a).name;
  }
}

export function remoteRef(remote: GitRemote | string, branch: string): GitObjectRef {
  const value: GitRemote = typeof remote === 'string' ? { name: remote, url: '' } : remote;
  return { kind: 'branch', branch: { type: 'remote', branch, remote: value } };
}

export function localRef(branch: string): GitObjectRef {
  return { kind: 'branch', branch: { type: 'local', branch } };
}

export function commitRef(sha: string): GitObjectRef {
  return { kind: 'commit', sha };
}

export function selectPreferredRemote(
  configuredRemote: string | undefined,
  remotes: ReadonlyArray<GitRemote>
): GitRemote {
  const preferred = configuredRemote?.trim();
  const found = preferred ? remotes.find((r) => r.name === preferred) : undefined;
  return (
    found ??
    remotes.find((r) => r.name === DEFAULT_REMOTE_NAME) ??
    remotes[0] ?? { name: DEFAULT_REMOTE_NAME, url: '' }
  );
}

export function resolveConfiguredRemotes(
  settings: { baseRemote?: string; pushRemote?: string } | undefined,
  remotes: ReadonlyArray<GitRemote>
): ConfiguredRemotes {
  const baseRemote = selectPreferredRemote(settings?.baseRemote, remotes);
  const pushRemoteName = settings?.pushRemote?.trim();
  const pushRemote = pushRemoteName
    ? remotes.find((remote) => remote.name === pushRemoteName)
    : undefined;

  return {
    baseRemote,
    pushRemote: pushRemote ?? baseRemote,
  };
}

export function bareRefName(ref: string): string {
  const slash = ref.indexOf('/');
  return slash !== -1 ? ref.slice(slash + 1) : ref;
}

type DefaultBranchResolutionArgs<TBranch extends GitBranchRef = GitBranchRef> = {
  preference?: GitBranchRef;
  branches: ReadonlyArray<TBranch>;
  configuredRemoteName: string;
  gitDefaultBranch?: string;
  baseRef?: string;
};

type BaseRefResolutionArgs = {
  detectedBaseRef: string;
  gitDefaultBranch?: string;
  branches: ReadonlyArray<GitBranchRef>;
};

function findLocalBranch<TBranch extends GitBranchRef>(
  branches: ReadonlyArray<TBranch>,
  branchName: string
): TBranch | undefined {
  return branches.find((b) => b.type === 'local' && b.branch === branchName);
}

function findRemoteBranch<TBranch extends GitBranchRef>(
  branches: ReadonlyArray<TBranch>,
  branchName: string,
  remoteName: string
): TBranch | undefined {
  return branches.find(
    (b) => b.type === 'remote' && b.branch === branchName && b.remote.name === remoteName
  );
}

function findAnyBranch<TBranch extends GitBranchRef>(
  branches: ReadonlyArray<TBranch>,
  branchName: string,
  remoteName: string
): TBranch | undefined {
  return (
    findLocalBranch(branches, branchName) ?? findRemoteBranch(branches, branchName, remoteName)
  );
}

function resolvePreference<TBranch extends GitBranchRef>(
  preference: GitBranchRef | undefined,
  branches: ReadonlyArray<TBranch>,
  configuredRemoteName: string
): TBranch | undefined {
  if (!preference) return undefined;
  return preference.type === 'remote'
    ? findRemoteBranch(branches, preference.branch, preference.remote.name)
    : (findLocalBranch(branches, preference.branch) ??
        findRemoteBranch(branches, preference.branch, configuredRemoteName));
}

export function remoteNameFromQualifiedRef(ref: string): string | undefined {
  const trimmed = ref.trim();
  const slash = trimmed.indexOf('/');
  if (slash <= 0) return undefined;
  return trimmed.slice(0, slash);
}

export function projectDefaultBranchToBranch(
  setting: ProjectSettings['defaultBranch'],
  configuredRemote: GitRemote,
  remotes: ReadonlyArray<GitRemote>
): GitBranchRef | undefined {
  if (!setting) return undefined;
  if (typeof setting !== 'string') {
    return { type: 'remote', branch: setting.name, remote: configuredRemote };
  }

  const remote = remotes.find((candidate) => setting.startsWith(`${candidate.name}/`));
  if (remote) {
    return { type: 'remote', branch: setting.slice(remote.name.length + 1), remote };
  }

  const slash = setting.indexOf('/');
  if (slash > 0) {
    return {
      type: 'remote',
      branch: setting.slice(slash + 1),
      remote: { name: setting.slice(0, slash), url: '' },
    };
  }

  return { type: 'local', branch: setting };
}

export function resolveDefaultBranch<TBranch extends GitBranchRef = GitBranchRef>(
  args: DefaultBranchResolutionArgs<TBranch>
): TBranch | undefined {
  const { preference, branches, configuredRemoteName, gitDefaultBranch, baseRef } = args;

  const explicit = resolvePreference(preference, branches, configuredRemoteName);
  if (explicit) return explicit;

  const remoteDefault = gitDefaultBranch?.trim()
    ? findRemoteBranch(branches, bareRefName(gitDefaultBranch), configuredRemoteName)
    : undefined;
  if (remoteDefault) return remoteDefault;

  const trimmedBaseRef = baseRef?.trim();
  const baseBranch = trimmedBaseRef ? bareRefName(trimmedBaseRef) : undefined;
  const base = baseBranch ? findAnyBranch(branches, baseBranch, configuredRemoteName) : undefined;
  if (base) return base;

  for (const candidate of ['main', 'master', 'develop', 'trunk']) {
    const branch = findAnyBranch(branches, candidate, configuredRemoteName);
    if (branch) return branch;
  }

  return undefined;
}

export function resolveBaseRefFromRemoteDefault(args: BaseRefResolutionArgs): string {
  const remoteName = remoteNameFromQualifiedRef(args.detectedBaseRef);
  if (!remoteName) return args.detectedBaseRef;

  const defaultBranch = args.gitDefaultBranch?.trim();
  if (!defaultBranch) return args.detectedBaseRef;

  const defaultBranchName = bareRefName(defaultBranch);
  const remoteDefault = findRemoteBranch(args.branches, defaultBranchName, remoteName);
  return remoteDefault ? `${remoteName}/${defaultBranchName}` : args.detectedBaseRef;
}
