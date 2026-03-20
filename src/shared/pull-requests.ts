export type PullRequestStatus = 'open' | 'closed' | 'merged';

export type PullRequestAuthor = {
  userName: string;
  displayName: string;
  avatarUrl?: string;
};

export type PullRequest = {
  id: string;
  provider: 'github';
  identifier: string; // a number for gh
  status: PullRequestStatus;
  url: string;
  isDraft?: boolean;
  title: string;
  headRefName: string;
  baseRefName: string;
  author?: PullRequestAuthor;
  reviewDecision?: 'approved' | 'changes_requested' | 'review_required';
  additions?: number;
  deletions?: number;
  changedFiles?: number;

  // defined if the pull request is from a fork
  headRepository?: {
    name: string;
    owner: string;
    url: string;
  };
};
