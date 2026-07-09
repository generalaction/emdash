import { authStatusModelStateSchema, type AuthStatusModelState } from '@emdash/core/acp/client';
import type { AcpRuntimeError } from '@emdash/core/acp/client';
import type { Result } from '@emdash/shared';
import { ReplicaLog, ReplicaState } from '@emdash/wire';
import { createImmutableMobxStore } from '@emdash/wire/util/mobx';
import type { Terminal } from '@xterm/xterm';
import { createXtermLogSink } from '../pty/xterm-log-sink';
import { getAcpRuntimeClient, type AcpRuntimeRpcClient } from './runtime-client';

export class AcpAuthLoginBinding {
  private disposed = false;

  private constructor(
    private readonly client: AcpRuntimeRpcClient,
    readonly providerId: string,
    readonly status: ReplicaState<AuthStatusModelState>,
    private readonly output: ReplicaLog
  ) {}

  static async create(args: {
    providerId: string;
    methodId: string;
    terminal: Pick<Terminal, 'reset' | 'write'>;
  }): Promise<AcpAuthLoginBinding> {
    const client = await getAcpRuntimeClient();
    const result = await client.startLogin({
      providerId: args.providerId,
      methodId: args.methodId,
    });
    if (!result.success) throw new Error(errorMessage(result));

    const key = { providerId: args.providerId };
    const status = new ReplicaState(client.authStatus.state(key, 'status'), {
      schema: authStatusModelStateSchema,
      store: createImmutableMobxStore(),
    });
    const output = new ReplicaLog(client.loginOutput.handle(key), {
      store: createXtermLogSink(args.terminal),
    });
    await Promise.all([status.ready, output.ready]);
    return new AcpAuthLoginBinding(client, args.providerId, status, output);
  }

  sendInput(data: string): void {
    if (this.disposed) return;
    void this.client.sendLoginInput({ providerId: this.providerId, data });
  }

  resize(cols: number, rows: number): void {
    if (this.disposed) return;
    void this.client.resizeLogin({ providerId: this.providerId, cols, rows });
  }

  markUrlHandled(urlId: string): void {
    if (this.disposed) return;
    void this.client.markUrlHandled({ providerId: this.providerId, urlId });
  }

  dispose(cancel = true): void {
    if (this.disposed) return;
    this.disposed = true;
    void this.status.dispose();
    void this.output.dispose();
    if (cancel) void this.client.cancelLogin({ providerId: this.providerId });
  }
}

function errorMessage(result: Result<unknown, AcpRuntimeError>): string {
  if (result.success) return '';
  return result.error.message ?? result.error.cause?.message ?? result.error.type;
}
