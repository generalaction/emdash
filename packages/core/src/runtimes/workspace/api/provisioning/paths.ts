import type { HostRef } from '@primitives/host/api';
import { formatAbsolute, hostFileRef, parseAbsolute, type HostFileRef } from '@primitives/path/api';

export function nativePathFromWorkspace(ref: HostFileRef): string {
  return formatAbsolute(ref.path, { separator: ref.path.root.kind === 'posix' ? '/' : '\\' });
}

export function workspaceFromNativePath(nativePath: string, host: HostRef): HostFileRef {
  const style = isWindowsAbsolute(nativePath) ? 'win32' : 'posix';
  const parsed = parseAbsolute(nativePath, {
    profile: { style, unicodeNormalization: 'preserve' },
  });
  if (!parsed.success) throw new Error(parsed.error.message);
  return hostFileRef(host, parsed.data);
}

function isWindowsAbsolute(input: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(input) || /^[/\\]{2}[^/\\]+[/\\][^/\\]+/u.test(input);
}
