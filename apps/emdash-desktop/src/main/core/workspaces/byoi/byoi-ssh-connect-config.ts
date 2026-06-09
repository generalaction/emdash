import type { ConnectConfig } from 'ssh2';
import { detectSshAuthSock } from '@main/utils/shellEnv';
import type { ProvisionOutput } from './provision-output';

type BYOIForwardAgentOptions = {
  env?: Record<string, string | undefined>;
};

function splitUserQualifiedHost(host: string): { host: string; username?: string } {
  const atIndex = host.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === host.length - 1) {
    return { host };
  }
  return {
    host: host.slice(atIndex + 1),
    username: host.slice(0, atIndex),
  };
}

export interface BYOIForwardAgentResolution {
  enabled: boolean;
  sshAuthSock?: string | null;
}

export function resolveBYOIForwardAgent(
  output: ProvisionOutput,
  options: BYOIForwardAgentOptions = {}
): BYOIForwardAgentResolution {
  const enabled = output.forwardAgent === true;
  const sshAuthSock =
    options.env !== undefined
      ? (options.env.SSH_AUTH_SOCK ?? null)
      : enabled
        ? (detectSshAuthSock() ?? null)
        : undefined;

  return {
    enabled,
    sshAuthSock,
  };
}

export function buildBYOISshConnectConfig({
  output,
  forwardAgent,
  sshAuthSock = detectSshAuthSock(),
}: {
  output: ProvisionOutput;
  forwardAgent: boolean;
  sshAuthSock?: string | null | undefined;
}): ConnectConfig {
  const host = splitUserQualifiedHost(output.host);
  const config: ConnectConfig = {
    host: host.host,
    port: output.port ?? 22,
    username: output.username ?? host.username ?? process.env['USER'],
  };

  if (output.password) {
    config.password = output.password;
  }

  if (sshAuthSock && (!output.password || forwardAgent)) {
    config.agent = sshAuthSock;
  }

  if (forwardAgent) {
    if (!sshAuthSock) {
      throw new Error('BYOI requested SSH agent forwarding, but no SSH agent socket is available');
    }
    config.agentForward = true;
  }

  return config;
}

export function resolveBYOISshConnectConfig(
  output: ProvisionOutput,
  options: BYOIForwardAgentOptions = {}
): ConnectConfig {
  const forwardAgent = resolveBYOIForwardAgent(output, options);
  return buildBYOISshConnectConfig({
    output,
    forwardAgent: forwardAgent.enabled,
    sshAuthSock: forwardAgent.sshAuthSock,
  });
}

export function resolveBYOIForwardAgentEnabled(
  output: ProvisionOutput,
  options: BYOIForwardAgentOptions = {}
): boolean {
  return resolveBYOIForwardAgent(output, options).enabled;
}
