export type NodeId = number;
export type FileTreeScope = NodeId | null;

export type FileNodeType = 'file' | 'directory';

export type DirectoryPreviewSegment = {
  name: string;
  path: string;
};

export type DirectoryPreview = {
  childCount: number;
  singleChildDirectoryChain: DirectoryPreviewSegment[];
};

export type FileNode = {
  id: NodeId;
  path: string;
  name: string;
  parentId: NodeId | null;
  type: FileNodeType;
  childrenLoaded: boolean;
  directoryPreview?: DirectoryPreview;
};
