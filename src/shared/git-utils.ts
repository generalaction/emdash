import type { Branch, Remote } from './git';

export const DEFAULT_REMOTE_NAME = 'origin';

export function selectPreferredRemote(
  configuredRemote: string | undefined,
  remotes: ReadonlyArray<Remote>
): Remote {
  const preferred = configuredRemote?.trim();
  const found = preferred ? remotes.find((r) => r.name === preferred) : undefined;
  return (
    found ??
    remotes.find((r) => r.name === DEFAULT_REMOTE_NAME) ??
    remotes[0] ?? { name: DEFAULT_REMOTE_NAME, url: '' }
  );
}

/**
 * Strips the remote prefix from a fully-qualified remote tracking ref.
 * e.g. "origin/main" → "main", "main" → "main"
 */
export function bareRefName(ref: string): string {
  const slash = ref.indexOf('/');
  return slash !== -1 ? ref.slice(slash + 1) : ref;
}

type DefaultBranchResolutionArgs<TBranch extends Branch = Branch> = {
  preference?: Branch;
  branches: ReadonlyArray<TBranch>;
  configuredRemoteName: string;
  gitDefaultBranch?: string;
  baseRef?: string;
};

type BaseRefResolutionArgs = {
  detectedBaseRef: string;
  gitDefaultBranch?: string;
  branches: ReadonlyArray<Branch>;
};

function findLocalBranch<TBranch extends Branch>(
  branches: ReadonlyArray<TBranch>,
  branchName: string
): TBranch | undefined {
  return branches.find((b) => b.type === 'local' && b.branch === branchName);
}

function findRemoteBranch<TBranch extends Branch>(
  branches: ReadonlyArray<TBranch>,
  branchName: string,
  remoteName: string
): TBranch | undefined {
  return branches.find(
    (b) => b.type === 'remote' && b.branch === branchName && b.remote.name === remoteName
  );
}

function findAnyBranch<TBranch extends Branch>(
  branches: ReadonlyArray<TBranch>,
  branchName: string,
  remoteName: string
): TBranch | undefined {
  return (
    findLocalBranch(branches, branchName) ?? findRemoteBranch(branches, branchName, remoteName)
  );
}

function resolvePreference<TBranch extends Branch>(
  preference: Branch | undefined,
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

export function resolveDefaultBranch<TBranch extends Branch = Branch>(
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
