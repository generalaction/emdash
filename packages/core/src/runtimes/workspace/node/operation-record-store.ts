import { createJsonFileKeyValueStore } from '@primitives/kv/node';
import {
  createKvWorkspaceOperationRecordStore,
  type WorkspaceOperationRecordStore,
} from '@runtimes/workspace/api/operation-records';

export type FileWorkspaceOperationRecordStoreOptions = {
  path: string;
};

export function createFileWorkspaceOperationRecordStore(
  options: FileWorkspaceOperationRecordStoreOptions
): WorkspaceOperationRecordStore {
  return createKvWorkspaceOperationRecordStore(createJsonFileKeyValueStore({ path: options.path }));
}
