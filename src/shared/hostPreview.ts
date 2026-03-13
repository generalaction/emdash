export type HostPreviewEvent = {
  type: 'url' | 'setup' | 'exit';
  taskId: string;
  url?: string;
  status?: 'starting' | 'line' | 'done' | 'error';
  line?: string;
};
