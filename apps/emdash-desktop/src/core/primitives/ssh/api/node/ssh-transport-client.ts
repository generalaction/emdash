import type { EventEmitter } from 'node:events';
import type { Duplex, Readable } from 'node:stream';
import type { ConnectConfig } from 'ssh2';

export type SshExecChannel = Duplex & { stderr: Readable };
export type SshChannelCallback<T extends Duplex = Duplex> = (
  error: Error | undefined,
  channel?: T
) => void;

/** 仅暴露桌面控制面需要的能力，运行时文件和终端操作仍由 Workspace Server 负责。 */
export interface SshTransportClient extends EventEmitter {
  connect(config: ConnectConfig): unknown;
  end(): unknown;
  destroy(): unknown;
  exec(command: string, callback: SshChannelCallback<SshExecChannel>): unknown;
  forwardOut(
    sourceHost: string,
    sourcePort: number,
    remoteHost: string,
    remotePort: number,
    callback: SshChannelCallback
  ): unknown;
  openssh_forwardOutStreamLocal(socketPath: string, callback: SshChannelCallback): unknown;
}
