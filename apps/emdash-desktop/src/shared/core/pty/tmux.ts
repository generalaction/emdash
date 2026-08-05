export type TmuxSessionIdentity = {
  projectId: string;
  taskId: string;
  leafId: string;
};

export type TmuxSessionConfig = TmuxSessionIdentity & {
  name: string;
};
