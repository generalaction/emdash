export interface FileNode {
  path: string;
  name: string;
  parentPath: string | null;
  depth: number;
  type: 'file' | 'directory';
  isHidden: boolean;
  extension?: string;
  mtime?: Date;
}

export type FileWatchEventType = 'create' | 'delete' | 'modify' | 'rename';

export interface FileWatchEvent {
  type: FileWatchEventType;
  entryType: 'file' | 'directory';
  path: string;
  oldPath?: string;
}
