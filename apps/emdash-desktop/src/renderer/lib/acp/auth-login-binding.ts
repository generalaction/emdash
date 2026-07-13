import {
  agentConfigListSchema,
  type AgentConfigError,
  type AgentConfigList,
  type AuthStatusModelState,
} from '@emdash/core/runtimes/agent-config/api';
import type { Result } from '@emdash/shared';
import { createScope, type Run, type Scope } from '@emdash/shared/concurrency';
import { ReplicaLog, ReplicaState } from '@emdash/wire';
import { createImmutableMobxStore } from '@emdash/wire/util/mobx';
import type { Terminal } from '@xterm/xterm';
import {
  getAgentConfigRuntimeClient,
  type AgentConfigRuntimeRpcClient,
} from '../agent-config/runtime-client';
import { createXtermLogSink } from '../pty/xterm-log-sink';

type AuthStatusHandle = {
  readonly ready: Promise<void>;
  current(): AuthStatusModelState;
  dispose(): Promise<void>;
};

export class AcpAuthLoginBinding {
  private constructor(
    private readonly scope: Scope,
    private readonly client: AgentConfigRuntimeRpcClient,
    readonly providerId: string,
    readonly status: AuthStatusHandle,
    private readonly cancellation: { cancelOnDispose: boolean }
  ) {}

  private resizeRun: Run<unknown> | undefined;

  static async create(args: {
    providerId: string;
    methodId: string;
    terminal: Pick<Terminal, 'reset' | 'write'>;
  }): Promise<AcpAuthLoginBinding> {
    const scope = createScope({ label: `auth-login:${args.providerId}` });
    const cancellation = { cancelOnDispose: true };
    try {
      const client = await getAgentConfigRuntimeClient();
      const result = await client.startLogin(
        {
          providerId: args.providerId,
          methodId: args.methodId,
        },
        { signal: scope.signal }
      );
      if (!result.success) throw new Error(errorMessage(result));

      scope.add(() => {
        if (!cancellation.cancelOnDispose) return;
        return client.cancelLogin({ providerId: args.providerId }).then(() => undefined);
      });

      const key = { providerId: args.providerId };
      const agents = new ReplicaState(client.agents.state(undefined, 'list'), {
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

      return new AcpAuthLoginBinding(scope, client, args.providerId, status, cancellation);
    } catch (error) {
      await scope.dispose(error);
      throw error;
    }
  }

  sendInput(data: string): void {
    if (this.scope.disposed) return;
    this.scope.run('send-login-input', (signal) =>
      this.client.sendLoginInput({ providerId: this.providerId, data }, { signal })
    );
  }

  resize(cols: number, rows: number): void {
    if (this.scope.disposed) return;
    this.resizeRun?.cancel(new Error('Login resize superseded'));
    const run = this.scope.run('resize-login', (signal) =>
      this.client.resizeLogin({ providerId: this.providerId, cols, rows }, { signal })
    );
    this.resizeRun = run;
    void run.exit.then(() => {
      if (this.resizeRun === run) this.resizeRun = undefined;
    });
  }

  markUrlHandled(urlId: string): void {
    if (this.scope.disposed) return;
    this.scope.run('mark-url-handled', (signal) =>
      this.client.markUrlHandled({ providerId: this.providerId, urlId }, { signal })
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

function errorMessage(result: Result<unknown, AgentConfigError>): string {
  if (result.success) return '';
  return 'message' in result.error ? result.error.message : result.error.type;
}
