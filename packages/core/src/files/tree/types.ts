import type { Lease, Result, Unsubscribe } from '@emdash/shared';
import type { CollectionSnapshot, CollectionUpdate } from '../../lib';
import type { FileTreeError } from './errors';
import type { FileNode, NodeId } from './models/tree';

export type FileTreeSnapshot = CollectionSnapshot<NodeId, FileNode>;
export type FileTreeUpdate = CollectionUpdate<NodeId, FileNode>;
export type FileTreeSequences = { tree?: number };

export type SubscribedSnapshot<Snapshot> = {
  snapshot: Snapshot;
  unsubscribe: Unsubscribe;
};

export interface IFileTree {
  readonly rootPath: string;

  ready(): Promise<Result<void, FileTreeError>>;
  getSnapshot(): Promise<Result<FileTreeSnapshot, FileTreeError>>;
  subscribe(cb: (update: FileTreeUpdate) => void): Unsubscribe;
  subscribeWithSnapshot(
    cb: (update: FileTreeUpdate) => void
  ): Promise<Result<SubscribedSnapshot<FileTreeSnapshot>, FileTreeError>>;
  expandDir(dirId: NodeId | null): Promise<Result<FileTreeSequences, FileTreeError>>;
  revealPath(path: string): Promise<Result<FileTreeSequences, FileTreeError>>;
  refresh(): Promise<Result<FileTreeSnapshot, FileTreeError>>;
  dispose(): Promise<void>;
}

export type FileTreeLease = Lease<IFileTree>;
