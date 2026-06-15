export type GitRemote = {
  name: string;
  url: string;
};

export type GitLocalBranchAddress = { type: 'local'; branch: string; remote?: GitRemote };

export type GitRemoteBranchAddress = { type: 'remote'; branch: string; remote: GitRemote };

export type GitBranchAddress = GitLocalBranchAddress | GitRemoteBranchAddress;

export type GitBranch =
  | (GitLocalBranchAddress & {
      oid: string;
      divergence?: { ahead: number; behind: number };
    })
  | (GitRemoteBranchAddress & { oid: string });

export type GitRefsModel = {
  branches: GitBranch[];
};

export type GitRemotesModel = {
  remotes: GitRemote[];
};
