import type { Branch } from '@shared/core/git/git';

export type BranchLabelRemoteMode = 'full' | 'short';

export function getBranchLabel(
  branch: Branch,
  options: { remote?: BranchLabelRemoteMode } = {}
): string {
  if (branch.type !== 'remote') return branch.branch;
  return options.remote === 'short' ? branch.branch : `${branch.remote.name}/${branch.branch}`;
}

export function filterBranchesForPicker(
  branches: ReadonlyArray<Branch>,
  tab: 'local' | 'remote',
  remoteName?: string
): Branch[] {
  return branches.filter(
    (branch) =>
      branch.type === tab &&
      (branch.type !== 'remote' || !remoteName || branch.remote.name === remoteName)
  );
}

export function prioritizeExactBranchMatches(
  branches: ReadonlyArray<Branch>,
  query: string,
  branchLabelRemote: BranchLabelRemoteMode = 'full'
): Branch[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...branches];

  return branches
    .map((branch, index) => ({
      branch,
      index,
      rank: getExactMatchRank(branch, normalizedQuery, branchLabelRemote),
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ branch }) => branch);
}

function getExactMatchRank(
  branch: Branch,
  normalizedQuery: string,
  branchLabelRemote: BranchLabelRemoteMode
): number {
  if (branch.branch.toLocaleLowerCase() === normalizedQuery) return 0;
  if (
    getBranchLabel(branch, { remote: branchLabelRemote }).toLocaleLowerCase() === normalizedQuery
  ) {
    return 1;
  }
  return 2;
}
