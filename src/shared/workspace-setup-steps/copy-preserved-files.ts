/** No args needed — context (repoPath, destPath) is provided by the executor. */
export type Args = Record<string, never>;

export type Success = Record<string, never>;

/** copy-preserved-files never fails fatally — errors are surfaced as warnings. */
export type Warning = {
  type: 'copy-failed';
  message: string;
};
