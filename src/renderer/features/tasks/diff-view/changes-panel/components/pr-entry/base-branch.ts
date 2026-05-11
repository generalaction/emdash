import type { Branch } from '@shared/git';

export function toShortBranchName(
  baseRef: string | undefined,
  branches: Branch[]
): string | undefined {
  const trimmed = baseRef?.trim();
  if (!trimmed) return undefined;

  if (branches.some((branch) => branch.branch === trimmed)) {
    return trimmed;
  }

  const knownRemotes = new Set<string>();
  for (const branch of branches) {
    if (branch.type === 'remote' && branch.remote.name) {
      knownRemotes.add(branch.remote.name);
    }
  }

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
  defaultBranch: Branch | undefined
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

  return defaultBranch;
}
