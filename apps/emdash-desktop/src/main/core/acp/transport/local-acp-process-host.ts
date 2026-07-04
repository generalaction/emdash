import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type {
  AcpFs,
  AcpProcessHandle,
  AcpProcessHost,
  AcpTerminalExit,
  AcpTerminalProcess,
} from '@emdash/core/acp';
import { getPlugin } from '@main/core/agents/plugin-registry';
import { resolveAgentExecutable } from '@main/core/conversations/impl/resolve-agent-executable';
import { localDependencyManager } from '@main/core/dependencies/dependency-managers';
import { hostDependencyStore } from '@main/core/dependencies/host-dependency-store';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { buildAgentEnv } from '@main/core/pty/pty-env';

// ---------------------------------------------------------------------------
// ChildProcessHandle
// ---------------------------------------------------------------------------

class ChildProcessHandle implements AcpProcessHandle {
  constructor(private readonly child: ReturnType<typeof spawn>) {}

  get stdin() {
    if (!this.child.stdin) throw new Error('LocalAcpProcessHost: child has no stdin');
    return this.child.stdin;
  }

  get stdout() {
    if (!this.child.stdout) throw new Error('LocalAcpProcessHost: child has no stdout');
    return this.child.stdout;
  }

  get stderr() {
    return this.child.stderr ?? undefined;
  }

  get exitCode() {
    return this.child.exitCode;
  }

  onExit(cb: (code: number | null) => void): void {
    this.child.on('exit', (code) => cb(code));
  }

  onError(cb: (err: Error) => void): void {
    this.child.on('error', cb);
  }

  kill(signal?: NodeJS.Signals): void {
    this.child.kill(signal ?? 'SIGTERM');
  }
}

// ---------------------------------------------------------------------------
// LocalAcpTerminalProcess
// ---------------------------------------------------------------------------

class LocalAcpTerminalProcess extends EventEmitter implements AcpTerminalProcess {
  private _exitCode: number | null = null;

  constructor(private readonly child: ReturnType<typeof spawn>) {
    super();
    child.on('exit', (code, signal) => {
      this._exitCode = code;
      this.emit('exit', { exitCode: code, signal: signal ?? null } satisfies AcpTerminalExit);
    });
    child.on('error', (err) => this.emit('error', err));
  }

  get stdout() {
    if (!this.child.stdout) throw new Error('LocalAcpTerminalProcess: child has no stdout');
    return this.child.stdout;
  }

  get stderr() {
    return this.child.stderr ?? undefined;
  }

  get exitCode() {
    return this._exitCode;
  }

  onExit(cb: (status: AcpTerminalExit) => void): void {
    this.on('exit', cb);
  }

  onError(cb: (err: Error) => void): void {
    this.on('error', cb);
  }

  kill(signal?: NodeJS.Signals): void {
    this.child.kill(signal ?? 'SIGTERM');
  }
}

// ---------------------------------------------------------------------------
// LocalAcpProcessHost
// ---------------------------------------------------------------------------

const localAcpFs: AcpFs = {
  readFile: (path, encoding) => readFile(path, encoding),
  writeFile: (path, content, encoding) => writeFile(path, content, encoding),
  mkdir: (path, opts) => mkdir(path, opts),
};

export class LocalAcpProcessHost implements AcpProcessHost {
  readonly fs: AcpFs = localAcpFs;

  async resolveSpawnContext(
    providerId: string
  ): Promise<{ cli: string; agentEnv: Record<string, string> }> {
    return resolveLocalAcpSpawnContext(providerId);
  }

  async spawn(spec: {
    command: string;
    args: string[];
    env: Record<string, string>;
    cwd: string;
  }): Promise<AcpProcessHandle> {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!child.stdin || !child.stdout) {
      throw new Error('LocalAcpProcessHost: failed to spawn process — no stdio streams');
    }

    return new ChildProcessHandle(child);
  }

  async spawnTerminal(spec: {
    command: string;
    args: string[];
    env: Record<string, string>;
    cwd: string;
  }): Promise<AcpTerminalProcess> {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      // stdin ignored; stdout + stderr piped so ManagedTerminal can buffer them
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (!child.stdout) {
      throw new Error('LocalAcpProcessHost: failed to spawn terminal — no stdout stream');
    }

    return new LocalAcpTerminalProcess(child);
  }
}

export async function resolveLocalAcpSpawnContext(
  providerId: string
): Promise<{ cli: string; agentEnv: Record<string, string> }> {
    const rawEnv = buildAgentEnv({ agentApiVars: true });
    const filteredEnv = Object.fromEntries(
      Object.entries(rawEnv).filter((e): e is [string, string] => e[1] !== undefined)
    );

    const plugin = getPlugin(providerId);
    const binaryName = plugin.capabilities.hostDependency.binaryNames[0] ?? providerId;
    const cachedStatePath = localDependencyManager.get(providerId as never)?.path;

    const cli = await resolveAgentExecutable({
      providerId,
      binaryName,
      ctx: new LocalExecutionContext(),
      hostDependencyStore,
      cachedStatePath,
    });

    return { cli, agentEnv: filteredEnv };
}
