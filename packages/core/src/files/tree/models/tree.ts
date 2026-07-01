import type { FileSymlinkInfo } from '../../symlinks';

export type NodeId = number;
export type FileTreeScope = NodeId | null;

export type FileNodeType = 'file' | 'directory' | 'symlink';

export type DirectoryPreviewSegment = {
  name: string;
  path: string;
};

export type DirectoryPreview = {
  childCount: number;
  singleChildDirectoryChain: DirectoryPreviewSegment[];
};

export type FileNodeBase = {
  id: NodeId;
  path: string;
  name: string;
  parentId: NodeId | null;
  childrenLoaded: boolean;
  directoryPreview?: DirectoryPreview;
};

export type FileNode =
  | (FileNodeBase & {
      type: 'file' | 'directory';
      symlink?: never;
    })
  | (FileNodeBase & {
      type: 'symlink';
      symlink: FileSymlinkInfo;
    });

export function isExpandableFileNode(node: Pick<FileNode, 'type' | 'symlink'>): boolean {
  return (
    node.type === 'directory' ||
    (node.type === 'symlink' &&
      node.symlink !== undefined &&
      !node.symlink.broken &&
      node.symlink.targetType === 'directory')
  );
}
