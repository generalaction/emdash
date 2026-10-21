import {
  absoluteRuntimePath,
  hostPathFromNative,
  nativePathFromHost,
  relativeRuntimePath,
} from '@core/primitives/desktop-runtime/api';

export function resolveWorkspacePath(workspacePath: string | undefined, filePath: string): string {
  if (!workspacePath) return filePath;
  const root = hostPathFromNative(workspacePath);
  return nativePathFromHost(absoluteRuntimePath(root, filePath));
}

export function relativeToWorkspace(workspacePath: string, filePath: string): string {
  try {
    return relativeRuntimePath(hostPathFromNative(workspacePath), filePath);
  } catch {
    return filePath;
  }
}
