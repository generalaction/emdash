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
