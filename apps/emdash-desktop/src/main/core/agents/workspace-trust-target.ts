import path from 'node:path';
import type { PluginFs } from '@emdash/core/services/agent-plugins/api/plugins';
import { log } from '@main/lib/logger';
import { createPluginFs } from './plugin-fs';

export type WorkspaceTrustHost = { kind: 'local'; homedir: string } | { kind: 'remote' };

export type TrustTarget = {
  fs: PluginFs;
  lockKey: string;
  workspacePath: string;
};

export async function resolveTrustTarget(
  host: WorkspaceTrustHost,
  workspacePath: string
): Promise<TrustTarget | null> {
  if (host.kind === 'remote') return null;
  if (!path.isAbsolute(workspacePath)) {
    log.warn('WorkspaceTrust: refusing to auto-trust non-absolute workspace path', {
      path: workspacePath,
    });
    return null;
  }
  return {
    fs: createPluginFs(host.homedir),
    lockKey: `local:${path.resolve(host.homedir)}`,
    workspacePath: path.normalize(workspacePath),
  };
}
