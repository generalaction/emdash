export type NodeId = number;
export type FileTreeScope = NodeId | null;

export type FileNodeType = 'file' | 'directory';

export type CompactChainSegment = {
  name: string;
  path: string;
};

export type FileNode = {
  id: NodeId;
  path: string;
  name: string;
  parentId: NodeId | null;
  type: FileNodeType;
  childrenLoaded: boolean;
  childCount?: number;
  compactChain?: CompactChainSegment[];
};
