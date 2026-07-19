import type { HostRef } from '@emdash/core/primitives/host/api';
import {
  agentConfigListSchema,
  type AgentConfigList,
  type AuthStatusModelState,
} from '@emdash/core/runtimes/agent-config/api';
import type { Result } from '@emdash/shared';
import { createScope, type Run, type Scope } from '@emdash/shared/concurrency';
import { ReplicaLog, ReplicaState } from '@emdash/wire';
import { createImmutableMobxStore } from '@emdash/wire/util/mobx';
import type { Terminal } from '@xterm/xterm';
import { createXtermLogSink } from '@core/features/terminals/browser/pty/xterm-log-sink';
import { getAgentsClient, type AgentsRpcClient } from './client';

type AuthStatusHandle = {
  readonly ready: Promise<void>;
  current(): AuthStatusModelState;
  dispose(): Promise<void>;
};

export class AcpAuthLoginBinding {
  private constructor(
    private readonly scope: Scope,
    private readonly client: AgentsRpcClient,
    readonly host: HostRef,
    readonly providerId: string,
    readonly status: AuthStatusHandle,
    private readonly cancellation: { cancelOnDispose: boolean }
  ) {}

  private resizeRun: Run<unknown> | undefined;

  static async create(args: {
    host: HostRef;
    providerId: string;
    methodId: string;
    terminal: Pick<Terminal, 'reset' | 'write'>;
  }): Promise<AcpAuthLoginBinding> {
    const scope = createScope({ label: `auth-login:${args.providerId}` });
    const cancellation = { cancelOnDispose: true };
    try {
      const client = await getAgentsClient();
      const result = await client.startLogin(
        {
          host: args.host,
          providerId: args.providerId,
          methodId: args.methodId,
        },
        { signal: scope.signal }
      );
      if (!result.success) throw new Error(errorMessage(result));

      scope.add(() => {
        if (!cancellation.cancelOnDispose) return;
        return client
          .cancelLogin({ host: args.host, providerId: args.providerId })
          .then(() => undefined);
      });

      const key = { host: args.host, providerId: args.providerId };
      const agents = new ReplicaState(client.auth.state({ host: args.host }, 'list'), {
        schema: agentConfigListSchema,
        store: createImmutableMobxStore(),
      });
      scope.add(() => agents.dispose());
      const status = createAuthStatusHandle(args.providerId, agents);
      const output = new ReplicaLog(client.loginOutput.handle(key), {
        store: createXtermLogSink(args.terminal),
      });
      scope.add(() => output.dispose());

      await scope
        .run('attach-replicas', async () => {
          await Promise.all([status.ready, output.ready]);
        })
        .value();

      return new AcpAuthLoginBinding(
        scope,
        client,
        args.host,
        args.providerId,
        status,
        cancellation
      );
    } catch (error) {
      await scope.dispose(error);
      throw error;
    }
  }

  sendInput(data: string): void {
    if (this.scope.disposed) return;
    this.scope.run('send-login-input', (signal) =>
      this.client.sendLoginInput({ host: this.host, providerId: this.providerId, data }, { signal })
    );
  }

  resize(cols: number, rows: number): void {
    if (this.scope.disposed) return;
    this.resizeRun?.cancel(new Error('Login resize superseded'));
    const run = this.scope.run('resize-login', (signal) =>
      this.client.resizeLogin(
        { host: this.host, providerId: this.providerId, cols, rows },
        { signal }
      )
    );
    this.resizeRun = run;
    void run.exit.then(() => {
      if (this.resizeRun === run) this.resizeRun = undefined;
    });
  }

  markUrlHandled(urlId: string): void {
    if (this.scope.disposed) return;
    this.scope.run('mark-url-handled', (signal) =>
      this.client.markUrlHandled(
        { host: this.host, providerId: this.providerId, urlId },
        { signal }
      )
    );
  }

  dispose(cancel = true): Promise<void> {
    this.cancellation.cancelOnDispose = cancel;
    return this.scope.dispose();
  }
}

function createAuthStatusHandle(
  providerId: string,
  agents: ReplicaState<AgentConfigList>
): AuthStatusHandle {
  return {
    ready: agents.ready,
    current: () =>
      agents.current()[providerId]?.auth ?? { status: { kind: 'unknown' }, login: null },
    dispose: async () => {
      await agents.dispose();
    },
  };
}

function errorMessage(result: Result<unknown, { type: string; message?: string }>): string {
  if (result.success) return '';
  return result.error.message ?? result.error.type;
}
