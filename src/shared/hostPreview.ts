export type HostPreviewEvent = {
  type: 'url' | 'setup' | 'exit';
  taskId: string;
  terminalId?: string;
  url?: string;
  status?: 'starting' | 'line' | 'done' | 'error';
  line?: string;
};
