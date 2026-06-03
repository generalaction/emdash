export type HostPreviewEvent = {
  type: 'url' | 'setup' | 'exit';
  projectId?: string;
  taskId: string;
  terminalId?: string;
  url?: string;
  status?: 'starting' | 'line' | 'done' | 'error';
  line?: string;
};
