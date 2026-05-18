import type { IExecutionContext } from '@main/core/execution-context/types';
import { resolveSshConfigHost } from '@main/core/ssh/sshConfigParser';

export async function resolveIdentityAgent(hostname: string): Promise<string | undefined> {
  const match = await resolveSshConfigHost(hostname, { allowHostNameMatch: true });
  return match?.identityAgent;
}

export async function resolveRemoteHome(ctx: IExecutionContext): Promise<string> {
  const { stdout } = await ctx.exec('sh', ['-c', 'printf %s "$HOME"']);
  const home = stdout.trim();
  if (!home) {
    throw new Error('Remote home directory is empty');
  }
  return home;
}
