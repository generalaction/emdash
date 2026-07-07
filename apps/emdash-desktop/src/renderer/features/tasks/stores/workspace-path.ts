export function resolveWorkspacePath(workspacePath: string | undefined, filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/');
  if (isAbsolutePath(normalizedPath) || !workspacePath) return normalizedPath;
  const root = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const relative = normalizedPath.replace(/^\/+/, '');
  return `${root}/${relative}`;
}

export function relativeToWorkspace(workspacePath: string, filePath: string): string {
  const root = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedPath = filePath.replace(/\\/g, '/');
  const prefix = `${root}/`;
  return normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : normalizedPath;
}

function isAbsolutePath(filePath: string): boolean {
  return filePath.startsWith('/') || /^[A-Za-z]:\//.test(filePath);
}
