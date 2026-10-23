import type { ConnectConfig } from 'ssh2';
import type { SshConfig } from '@core/primitives/ssh/api';

export type OpenSshTarget = Pick<
  SshConfig,
  'host' | 'port' | 'username' | 'sshConfigAlias' | 'proxyJump' | 'forwardAgent'
>;

export function validateOpenSshTarget(target: OpenSshTarget): void {
  const destination = target.sshConfigAlias || target.host;
  if (!/^[A-Za-z0-9._@%+:/[\]-]+$/.test(destination) || destination.startsWith('-')) {
    throw new Error('Invalid SSH destination');
  }
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
    throw new Error('Invalid SSH port');
  }
  if (/[\r\n\0]/.test(target.username) || !target.username) {
    throw new Error('Invalid SSH username');
  }
  if (
    target.proxyJump &&
    (!/^[A-Za-z0-9._@%+:/[\],-]+$/.test(target.proxyJump) || target.proxyJump.startsWith('-'))
  ) {
    throw new Error('Invalid SSH jump host');
  }
}

export function openSshMasterArgs(
  target: OpenSshTarget,
  socket: string,
  config: ConnectConfig,
  marker: string
): string[] {
  const options = [
    'ControlPersist=no',
    'StdinNull=no',
    'ForkAfterAuthentication=no',
    'BatchMode=yes',
    'StrictHostKeyChecking=yes',
    'ClearAllForwardings=yes',
    'RemoteCommand=none',
    'SessionType=default',
    'GSSAPIAuthentication=yes',
    'PreferredAuthentications=gssapi-with-mic',
    `ConnectTimeout=${Math.max(1, Math.ceil((config.readyTimeout ?? 20_000) / 1000))}`,
    `ServerAliveInterval=${Math.max(1, Math.ceil((config.keepaliveInterval ?? 60_000) / 1000))}`,
    `ServerAliveCountMax=${config.keepaliveCountMax ?? 3}`,
  ];
  const args = ['-M', '-S', socket, '-T', ...options.flatMap((option) => ['-o', option])];
  // 保留别名以支持 Match/ProxyCommand；手动连接才覆盖目的地址参数。
  if (!target.sshConfigAlias) {
    args.push('-p', String(target.port), '-l', target.username);
    args.push('-o', `ForwardAgent=${target.forwardAgent ? 'yes' : 'no'}`);
    if (target.proxyJump) args.push('-J', target.proxyJump);
  }
  args.push('--', target.sshConfigAlias || target.host, `printf '${marker}\\n'; cat`);
  return args;
}

/** 禁止复用失败后重新认证，确保操作始终属于原物理连接。 */
export function openSshSlaveArgs(socket: string): string[] {
  return [
    '-F',
    '/dev/null',
    '-S',
    socket,
    '-T',
    '-o',
    'ControlMaster=no',
    '-o',
    'BatchMode=yes',
    '-o',
    'ProxyCommand=false',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'ConnectTimeout=10',
  ];
}
