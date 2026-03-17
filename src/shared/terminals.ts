export type Terminal = {
  id: string;
  projectId: string;
  taskId: string;
  name: string;
};

export type CreateTerminalParams = {
  id: string;
  projectId: string;
  taskId: string;
  name: string;
  initialSize?: { cols: number; rows: number };
};
