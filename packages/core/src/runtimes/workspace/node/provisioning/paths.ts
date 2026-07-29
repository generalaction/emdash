import path from 'node:path';
export {
  nativePathFromWorkspace,
  workspaceFromNativePath,
} from '@runtimes/workspace/api/provisioning';

export function resolveNativePath(base: string, input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(base, input);
}
