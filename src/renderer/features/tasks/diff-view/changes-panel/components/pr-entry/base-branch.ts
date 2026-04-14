import type { Branch, DefaultBranch } from '@shared/git';

export function toShortBranchName(
  baseRef: string | undefined,
  branches: Branch[]
): string | undefined {
  const trimmed = baseRef?.trim();
  if (!trimmed) return undefined;

  if (branches.some((branch) => branch.branch === trimmed)) {
    return trimmed;
  }

  const knownRemotes = new Set(
    branches
      .filter((branch): branch is Extract<Branch, { type: 'remote' }> => branch.type === 'remote')
      .map((branch) => branch.remote)
      .filter(Boolean)
  );

  for (const remote of knownRemotes) {
    const prefix = `${remote}/`;
    if (trimmed.startsWith(prefix)) {
      const candidate = trimmed.slice(prefix.length);
      if (candidate && branches.some((branch) => branch.branch === candidate)) {
        return candidate;
      }
    }
  }

  return trimmed;
}

export function resolveInitialBaseBranch(
  branches: Branch[],
  preferredBaseRef: string | undefined,
  defaultBranch: DefaultBranch | undefined
): Branch | undefined {
  const preferredName = toShortBranchName(preferredBaseRef, branches);
  if (preferredName) {
    const preferredLocal = branches.find(
      (branch) => branch.type === 'local' && branch.branch === preferredName
    );
    if (preferredLocal) return preferredLocal;

    const preferredRemote = branches.find(
      (branch) => branch.type === 'remote' && branch.branch === preferredName
    );
    if (preferredRemote) return preferredRemote;
  }

  if (!defaultBranch) return undefined;

  const local = branches.find(
    (branch) => branch.type === 'local' && branch.branch === defaultBranch.name
  );
  if (local) return local;

  const remoteExact = branches.find(
    (branch) =>
      branch.type === 'remote' &&
      branch.branch === defaultBranch.name &&
      branch.remote === defaultBranch.remote
  );
  if (remoteExact) return remoteExact;

  const remoteAny = branches.find(
    (branch) => branch.type === 'remote' && branch.branch === defaultBranch.name
  );
  return remoteAny;
}
