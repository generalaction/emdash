import { absoluteDirname, containsAbsolute } from '@emdash/core/primitives/path/api';
import {
  absoluteRuntimePath,
  hostPathFromNative,
  nativePathFromHost,
} from '@core/primitives/desktop-runtime/api';

export interface WorkspaceResourcePathArgs {
  /** Absolute workspace root. Resolution fails closed when this is missing. */
  workspacePath: string | undefined;
  /** Absolute path of the document that references the resource. */
  containingFilePath: string;
  /** The raw resource reference (src/href/url) from the document. */
  resourcePath: string;
}

export function resolveWorkspaceResourcePath(args: WorkspaceResourcePathArgs): string | null {
  const { workspacePath, containingFilePath, resourcePath } = args;
  const cleanSrc = resourcePath.trim().split('#')[0]?.split('?')[0] ?? '';
  if (!cleanSrc) return null;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(cleanSrc)) return null;
  if (/^[/\\]{2}/u.test(cleanSrc) || cleanSrc.startsWith('#')) return null;
  if (!workspacePath) return null;

  try {
    const root = hostPathFromNative(workspacePath);
    const containing = hostPathFromNative(containingFilePath);
    if (!containsAbsolute(root, containing)) return null;

    const base = /^[/\\]/u.test(cleanSrc) ? root : absoluteDirname(containing);
    if (!base) return null;
    const relative = cleanSrc.replace(/^[/\\]+/u, '');
    const resolved = absoluteRuntimePath(base, relative);
    if (!containsAbsolute(root, resolved)) return null;
    return nativePathFromHost(resolved);
  } catch {
    return null;
  }
}
