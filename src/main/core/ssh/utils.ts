import type { IExecutionContext } from '@main/core/execution-context/types';
import { parseSshConfigFile } from '@main/core/ssh/sshConfigParser';

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

export async function resolveRemoteHome(ctx: IExecutionContext): Promise<string> {
  const { stdout } = await ctx.exec('sh', ['-c', 'printf %s "$HOME"']);
  const home = stdout.trim();
  if (!home) {
    throw new Error('Remote home directory is empty');
  }
  return home;
}
