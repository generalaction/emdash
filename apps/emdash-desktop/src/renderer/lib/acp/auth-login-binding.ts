import {
  agentConfigListSchema,
  type AgentConfigError,
  type AgentConfigList,
  type AuthStatusModelState,
} from '@emdash/core/workspace-server/agent-config';
import type { Result } from '@emdash/shared';
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
  dispose(): void;
};

export class AcpAuthLoginBinding {
  private disposed = false;

  private constructor(
    private readonly client: AgentConfigRuntimeRpcClient,
    readonly providerId: string,
    readonly status: AuthStatusHandle,
    private readonly output: ReplicaLog
  ) {}

  static async create(args: {
    providerId: string;
    methodId: string;
    terminal: Pick<Terminal, 'reset' | 'write'>;
  }): Promise<AcpAuthLoginBinding> {
    const client = await getAgentConfigRuntimeClient();
    const result = await client.startLogin({
      providerId: args.providerId,
      methodId: args.methodId,
    });
    if (!result.success) throw new Error(errorMessage(result));

    const key = { providerId: args.providerId };
    const agents = new ReplicaState(client.agents.state(undefined, 'list'), {
      schema: agentConfigListSchema,
      store: createImmutableMobxStore(),
    });
    const status = createAuthStatusHandle(args.providerId, agents);
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

function createAuthStatusHandle(
  providerId: string,
  agents: ReplicaState<AgentConfigList>
): AuthStatusHandle {
  return {
    ready: agents.ready,
    current: () => agents.current()[providerId]?.auth ?? { status: { kind: 'unknown' }, login: null },
    dispose: () => {
      void agents.dispose();
    },
  };
}

function errorMessage(result: Result<unknown, AgentConfigError>): string {
  if (result.success) return '';
  return 'message' in result.error ? result.error.message : result.error.type;
}
