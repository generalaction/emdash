import crypto from 'node:crypto';

export function computeWorkspaceKey(
  type: 'local' | 'project-ssh',
  absolutePath: string,
  connectionId?: string
): string {
  const input =
    type === 'project-ssh' && connectionId
      ? `ssh:${connectionId}:${absolutePath}`
      : `local:${absolutePath}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}
