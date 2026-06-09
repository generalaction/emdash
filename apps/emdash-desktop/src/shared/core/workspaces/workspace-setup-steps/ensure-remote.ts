export type Args = {
  name: string;
  url: string;
};

export type Success = Record<string, never>;

export type Error = {
  type: 'remote-error';
  name: string;
  message: string;
};
