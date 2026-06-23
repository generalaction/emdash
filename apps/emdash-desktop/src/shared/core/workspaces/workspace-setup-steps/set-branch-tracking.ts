export type Args = {
  branchName: string;
  remote: string;
  remoteBranch: string;
};

export type Success = Record<string, never>;

/** set-branch-tracking never fails fatally — errors are surfaced as warnings. */
export type Warning = {
  type: 'tracking-failed';
  branchName: string;
  message: string;
};
