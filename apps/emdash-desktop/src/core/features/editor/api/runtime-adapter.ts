import type { HostRef } from '@emdash/core/primitives/host/api';
import { filesContract } from '@emdash/core/runtimes/files/api';
import {
  runtimeResolveErrorAsError,
  type HostRuntimesClient,
  type RuntimeBroker,
  type RuntimeResolveError,
} from '@emdash/core/services/runtime-broker/api';

export const editorFilesRuntimeContract = filesContract;

export type EditorHostRuntimesClient = HostRuntimesClient;
export type EditorRuntimeBroker = Pick<RuntimeBroker, 'session'>;
export type EditorRuntimeResolveError = RuntimeResolveError;

export function throwEditorRuntimeResolveError(error: RuntimeResolveError): never {
  throw runtimeResolveErrorAsError(error);
}

export type EditorWorkspaceIdentity = Readonly<{
  workspaceId: string;
  host: HostRef;
  path: string;
  projectId: string;
}>;

export type EditorWorkspaceIdentityResolver = Readonly<{
  resolve(workspaceId: string): Promise<EditorWorkspaceIdentity | null>;
}>;
