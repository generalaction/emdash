import { parseSshConfigFile } from '@main/utils/sshConfigParser';

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
