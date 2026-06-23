export type FileWatchEventType = 'create' | 'delete' | 'modify' | 'rename';

export interface FileWatchEvent {
  type: FileWatchEventType;
  entryType: 'file' | 'directory';
  path: string;
  oldPath?: string;
}
