import { parseSshConfigFile } from '@main/core/ssh/sshConfigParser';
import type { ExecFn } from '@main/core/utils/exec';

export async function resolveIdentityAgent(hostname: string): Promise<string | undefined> {
  try {
    const hosts = await parseSshConfigFile();
    const match = hosts.find(
      (h) =>
        h.host.toLowerCase() === hostname.toLowerCase() ||
        h.hostname?.toLowerCase() === hostname.toLowerCase()
    );
    return match?.identityAgent;
  } catch {
    return undefined;
  }
}

export async function resolveRemoteHome(exec: ExecFn): Promise<string> {
  const { stdout } = await exec('sh', ['-c', 'printf %s "$HOME"']);
  const home = stdout.trim();
  if (!home) {
    throw new Error('Remote home directory is empty');
  }
  return home;
}
