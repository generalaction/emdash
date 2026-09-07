import type { HostAbsolutePath } from '@emdash/core/primitives/path/api';
import { hostPathFromNative, nativePathFromHost } from '@core/primitives/desktop-runtime/api';

export type ProjectDirectoryLocation = {
  root: HostAbsolutePath;
  navigationRoot: string;
  separator: '/' | '\\';
};

export function projectDirectoryLocation(path: string): ProjectDirectoryLocation | null {
  try {
    const root = hostPathFromNative(path);
    return {
      root,
      navigationRoot: nativePathFromHost({ root: root.root, segments: [] }),
      separator: root.root.kind === 'posix' ? '/' : '\\',
    };
  } catch {
    return null;
  }
}
