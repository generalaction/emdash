/**
 * Build a stable Monaco model URI for a file within a project/worktree context.
 * Monaco uses this identity to keep model-local undo/redo history.
 */
export function buildMonacoModelPath(rootPath: string, filePath: string): string {
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/g, '');
  const normalizedFile = filePath.replace(/\\/g, '/').replace(/^\/+/g, '');
  const joined = `${normalizedRoot}/${normalizedFile}`.replace(/\/{2,}/g, '/');
  const absolute = joined.startsWith('/') ? joined : `/${joined}`;
  return `file://${encodeURI(absolute)}`;
}
