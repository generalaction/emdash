export type GitRemote = {
  name: string;
  url: string;
};

export type GitLocalBranchRef = { type: 'local'; branch: string; remote?: GitRemote };

export type GitRemoteBranchRef = { type: 'remote'; branch: string; remote: GitRemote };

export type GitBranchRef = GitLocalBranchRef | GitRemoteBranchRef;

export type LocalBranch = GitLocalBranchRef & {
  oid: string;
  divergence?: { ahead: number; behind: number };
};

export type RemoteBranch = GitRemoteBranchRef & { oid: string };

export type GitBranch = LocalBranch | RemoteBranch;

export type GitRefsModel = {
  branches: GitBranch[];
};

export type GitRemotesModel = {
  remotes: GitRemote[];
};
