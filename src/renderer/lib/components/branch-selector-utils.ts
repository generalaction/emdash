import type { Branch } from '@shared/git';

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
