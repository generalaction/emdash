import path from 'node:path';

export function isAbsoluteMachinePath(filePath: string): boolean {
  return path.posix.isAbsolute(filePath) || path.win32.isAbsolute(filePath);
}

export function joinMachinePath(basePath: string, ...segments: string[]): string {
  let current = basePath;
  for (const segment of segments) {
    const normalized = segment.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized) continue;
    current =
      current.endsWith('/') || current.endsWith('\\')
        ? `${current}${normalized}`
        : `${current}/${normalized}`;
  }
  return current;
}

export function dirnameMachinePath(value: string): string {
  if (path.win32.isAbsolute(value)) return path.win32.dirname(value).replace(/\\/g, '/');
  return path.posix.dirname(value.replace(/\\/g, '/'));
}

export function basenameMachinePath(value: string): string {
  if (path.win32.isAbsolute(value)) return path.win32.basename(value);
  return path.posix.basename(value.replace(/\\/g, '/'));
}

export function containsMachinePath(parentPath: string, childPath: string): boolean {
  const parent = parentPath.replace(/\\/g, '/');
  const child = childPath.replace(/\\/g, '/');
  const rel = path.posix.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !path.posix.isAbsolute(rel));
}

export function displayPathInDirectory(parentPath: string, childPath: string): string {
  const rel = path.posix.relative(parentPath.replace(/\\/g, '/'), childPath.replace(/\\/g, '/'));
  return rel === '.' ? '' : rel;
}
