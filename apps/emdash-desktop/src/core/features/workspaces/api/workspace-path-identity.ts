import { hostRefKey, type HostRef } from '@emdash/core/primitives/host/api';
import { nativePathIdentityKey, stableNativePathDisplay } from '@emdash/core/primitives/path/api';

/** Canonical path identity; display and execution continue using the original string. */
export function workspacePathIdentityKey(path: string): string {
  return nativePathIdentityKey(path);
}

export function stableWorkspacePathDisplay(current: string, incoming: string): string {
  return stableNativePathDisplay(current, incoming);
}

export function hostWorkspacePathIdentityKey(host: HostRef, path: string): string {
  return `${hostRefKey(host)}\0${workspacePathIdentityKey(path)}`;
}

export function storedWorkspacePathIdentityKey(
  location: 'local' | 'remote',
  sshConnectionId: string | null,
  path: string
): string {
  const hostKey = location === 'local' ? 'local' : `remote:${sshConnectionId ?? ''}`;
  return `${hostKey}\0${workspacePathIdentityKey(path)}`;
}
