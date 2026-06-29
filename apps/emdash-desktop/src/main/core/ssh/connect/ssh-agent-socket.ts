export const WINDOWS_OPENSSH_AGENT_PIPE = '\\\\.\\pipe\\openssh-ssh-agent';

export function defaultSshAgentSocket(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform
): string | undefined {
  return env.SSH_AUTH_SOCK || (platform === 'win32' ? WINDOWS_OPENSSH_AGENT_PIPE : undefined);
}
