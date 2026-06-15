import type { GitBranchAddress } from './refs';

export type DiffMode = { kind: 'head' } | { kind: 'staged' };

export type GitObjectRef =
  | { kind: 'branch'; branch: GitBranchAddress }
  | { kind: 'commit'; sha: string }
  | { kind: 'tag'; name: string };

export type MergeBaseRange = {
  base: GitObjectRef;
  head: GitObjectRef;
};

export type DiffTarget = DiffMode | GitObjectRef | MergeBaseRange;

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

export function toRangeString(range: MergeBaseRange): string {
  return `${toRefString(range.base)}...${toRefString(range.head)}`;
}
