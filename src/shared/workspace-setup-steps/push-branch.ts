export type Args = {
  branchName: string;
  remote: string;
  /** When true, passes -u to `git push` to set upstream tracking in one operation. */
  setUpstream?: boolean;
};

export type Success = Record<string, never>;

/** push-branch never fails fatally — errors are surfaced as warnings. */
export type Warning = {
  type: 'push-failed';
  branchName: string;
  remote: string;
  message: string;
};
