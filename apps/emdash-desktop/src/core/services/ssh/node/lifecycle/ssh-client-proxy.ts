import { formatCommandLine, type Command } from '@emdash/core/primitives/exec/api';
import type {
  SshClientProxy as SshClientProxyContract,
  SshExecOptions,
  SshForwardOptions,
} from '@core/primitives/ssh/api/node/ssh-client-proxy';
import type { SshSession } from '../openssh/session';

/** A stable logical handle; replacing its session revokes every operation from the old generation. */
export class SshClientProxy implements SshClientProxyContract {
  private session: SshSession | undefined;
  private lifetime = new AbortController();
  constructor(readonly connectionId: string) {}

  update(session: SshSession): void {
    this.invalidate();
    this.lifetime = new AbortController();
    this.session = session;
  }
  invalidate(): void {
    this.session = undefined;
    this.lifetime.abort(new Error('SSH connection is not available'));
  }
  get isConnected(): boolean {
    return this.session !== undefined;
  }

  async exec(command: Command, options: SshExecOptions = {}) {
    return this.execScript(formatCommandLine(command, 'posix'), options);
  }
  async execScript(command: string, options: SshExecOptions = {}) {
    const { session, signal } = this.capture(options.signal);
    return session.exec(command, { ...options, signal });
  }
  async openStream(command: Command, options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
    const { session, signal } = this.capture(options.signal);
    return session.openStream(formatCommandLine(command, 'posix'), { ...options, signal });
  }
  async forwardPort(remotePort: number, options: SshForwardOptions = {}) {
    const { session, signal } = this.capture(options.signal);
    return session.forwardPort(remotePort, { ...options, signal });
  }
  private capture(caller?: AbortSignal) {
    if (!this.session) throw new Error('SSH connection is not available');
    const signal = caller ? AbortSignal.any([caller, this.lifetime.signal]) : this.lifetime.signal;
    signal.throwIfAborted();
    return { session: this.session, signal };
  }
}
