import type { HostRef } from '@emdash/core/primitives/host/api';
import {
  workspaceContract as workspaceRuntimeContract,
  type WorkspaceError,
  type WorkspaceOperationResult,
} from '@emdash/core/runtimes/workspace/api';
import {
  isRuntimeResolveError,
  runtimeResolveErrorAsError,
  type HostRuntimesClient,
  type RuntimeBroker,
  type RuntimeResolveError,
} from '@emdash/core/services/runtime-broker/api';

export { workspaceRuntimeContract };

export type WorkspacesHostRuntimesClient = HostRuntimesClient;
export type WorkspacesRuntimeBroker = Pick<RuntimeBroker, 'client'>;
export type WorkspacesRuntimeError = WorkspaceError;
export type WorkspacesRuntimeResolveError = RuntimeResolveError;
export type WorkspacesRuntimeOperationResult = WorkspaceOperationResult;

export function isWorkspacesRuntimeResolveError(
  value: unknown
): value is WorkspacesRuntimeResolveError {
  return isRuntimeResolveError(value);
}

export function throwWorkspacesRuntimeResolveError(error: RuntimeResolveError): never {
  throw runtimeResolveErrorAsError(error);
}

export type WorkspacesIdentity = Readonly<{
  workspaceId: string;
  host: HostRef;
  path: string;
  projectId: string;
}>;
export type WorkspacesIdentityResolver = Readonly<{
  resolve(workspaceId: string): Promise<WorkspacesIdentity | null>;
  resolveProject(projectId: string): Promise<WorkspacesIdentity | null>;
  findByPath(path: string, host?: HostRef): Promise<WorkspacesIdentity | null>;
}>;
