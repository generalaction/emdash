import type { GitExecErrorCode } from '@emdash/core/runtimes/git/api';

export type Args = {
  remote: string;
  refspec?: string;
  force?: boolean;
};

export type Success = Record<string, never>;

export type Error = {
  type: 'fetch-failed';
  remote: string;
  refspec?: string;
  code?: GitExecErrorCode;
  message: string;
};
