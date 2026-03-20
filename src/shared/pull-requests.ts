export type PullRequestStatus = 'open' | 'closed' | 'merged';

export type CheckRunBucket = 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel';

export type PullRequestAuthor = {
  userName: string;
  displayName: string;
  avatarUrl?: string;
};

export type PullRequest = {
  provider: 'github';
  status: PullRequestStatus;
  url: string;
  title: string;
  identifier: string;
  // source branch name
  headRefName: string;
  headRefOid?: string;
  // target branch name
  baseRefName: string;
  author?: PullRequestAuthor;
  // defined if the pull request is from a fork
  headRepository?: {
    name: string;
    owner: string;
    url: string;
  };
};
