export type FileSymlinkTargetType = 'file' | 'directory' | 'other' | 'unknown';

export type FileSymlinkInfo = {
  targetPath?: string;
  realPath?: string;
  targetType: FileSymlinkTargetType;
  broken: boolean;
};
