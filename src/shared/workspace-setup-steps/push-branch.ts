export type Args = {
  branchName: string;
  remote: string;
};

export type Success = Record<string, never>;

/** push-branch never fails fatally — errors are surfaced as warnings. */
export type Warning = {
  type: 'push-failed';
  branchName: string;
  remote: string;
  message: string;
};
