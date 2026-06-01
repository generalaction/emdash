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
  message: string;
};
