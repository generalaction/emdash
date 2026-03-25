export interface ResolveRemoteProjectNameInput {
  remotePath: string;
  fallbackName?: string;
  currentName: string;
  wasCustomized: boolean;
}

export function deriveRemoteProjectName(remotePath: string, fallbackName = ''): string {
  const segments = remotePath.split('/').filter(Boolean);
  return segments.at(-1) ?? fallbackName.trim();
}

export function resolveRemoteProjectName({
  remotePath,
  fallbackName = '',
  currentName,
  wasCustomized,
}: ResolveRemoteProjectNameInput): string {
  return wasCustomized ? currentName : deriveRemoteProjectName(remotePath, fallbackName);
}
