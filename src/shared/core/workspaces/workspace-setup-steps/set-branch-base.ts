export type Args = {
  branchName: string;
  /** The value to write to git config `branch.<name>.base`. */
  baseRef: string;
};

export type Success = Record<string, never>;

/** set-branch-base never fails fatally — errors are surfaced as warnings. */
export type Warning = {
  type: 'base-config-failed';
  branchName: string;
  message: string;
};
