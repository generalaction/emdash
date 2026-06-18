import type { GitChangeStatus } from './status';

export type Commit = {
  hash: string;
  parents: string[];
  subject: string;
  body: string;
  author: string;
  date: string;
  isPushed: boolean;
  tags: string[];
};

export type CommitFile = {
  path: string;
  status: GitChangeStatus;
  additions: number;
  deletions: number;
};

export type GitLogResult = {
  commits: Commit[];
  aheadCount: number;
};
