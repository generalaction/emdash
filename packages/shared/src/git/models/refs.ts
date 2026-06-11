export type GitRemote = {
  name: string;
  url: string;
};

export type GitBranch =
  | {
      type: 'local';
      branch: string;
      remote?: GitRemote;
      divergence?: { ahead: number; behind: number };
    }
  | { type: 'remote'; branch: string; remote: GitRemote };

export type GitRefsModel = {
  branches: GitBranch[];
};

export type GitRemotesModel = {
  remotes: GitRemote[];
};

export type DiffMode = { kind: 'head' } | { kind: 'staged' };

export type GitObjectRef =
  | { kind: 'branch'; branch: GitBranch }
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
