import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { recordSpawn } from '@emdash/shared/perf';
import {
  createChildProcessTreeTerminator,
  planExecutableLaunch,
  type FileExists,
  type ProcessTreeTerminator,
} from '#primitives/exec/node';
import type {
  AcpFs,
  AcpProcessHandle,
  AcpTerminalExit,
  AcpTerminalProcess,
} from '#runtimes/acp/api/transport';
import type { AcpRuntimeProcessHost } from '#runtimes/acp/node/runtime/types';

class ChildProcessHandle implements AcpProcessHandle {
  private readonly terminator: ProcessTreeTerminator;

  constructor(
    private readonly child: ReturnType<typeof spawn>,
    platform: NodeJS.Platform
  ) {
    this.terminator = createChildProcessTreeTerminator(child, {
      platform,
      processGroup: platform !== 'win32',
    });
  }

  get stdin() {
    if (!this.child.stdin) throw new Error('ChildAcpProcessHost: child has no stdin');
    return this.child.stdin;
  }

  get stdout() {
    if (!this.child.stdout) throw new Error('ChildAcpProcessHost: child has no stdout');
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

  kill(signal?: NodeJS.Signals): Promise<void> {
    return this.terminator.terminate(signal);
  }
}

class ChildTerminalProcess extends EventEmitter implements AcpTerminalProcess {
  private _exitCode: number | null = null;
  private readonly terminator: ProcessTreeTerminator;

  constructor(
    private readonly child: ReturnType<typeof spawn>,
    platform: NodeJS.Platform
  ) {
    super();
    this.terminator = createChildProcessTreeTerminator(child, {
      platform,
      processGroup: platform !== 'win32',
    });
    child.on('exit', (code, signal) => {
      this._exitCode = code;
      this.emit('exit', { exitCode: code, signal: signal ?? null } satisfies AcpTerminalExit);
    });
    child.on('error', (err) => this.emit('error', err));
  }

  get stdout() {
    if (!this.child.stdout) throw new Error('ChildTerminalProcess: child has no stdout');
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

  kill(signal?: NodeJS.Signals): Promise<void> {
    return this.terminator.terminate(signal);
  }
}

const fsPort: AcpFs = {
  readFile: (path, encoding) => readFile(path, encoding),
  writeFile: (path, content, encoding) => writeFile(path, content, encoding),
  mkdir: (path, opts) => mkdir(path, opts),
};

export class ChildAcpProcessHost implements AcpRuntimeProcessHost {
  readonly fs = fsPort;

  constructor(
    private readonly options: {
      platform?: NodeJS.Platform;
      fileExists?: FileExists;
    } = {}
  ) {}

  async spawn(spec: {
    command: string;
    args: string[];
    env: Record<string, string>;
    cwd: string;
  }): Promise<AcpProcessHandle> {
    const platform = this.options.platform ?? process.platform;
    const plan = planExecutableLaunch({
      platform,
      command: spec.command,
      args: spec.args,
      cwd: spec.cwd,
      env: spec.env,
      fileExists: this.options.fileExists,
    });
    recordSpawn('agent', plan.executable);
    const child = spawn(plan.executable, plan.args, {
      cwd: plan.cwd,
      detached: platform !== 'win32',
      env: spec.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsVerbatimArguments: plan.windowsVerbatimArguments,
    });
    if (!child.stdin || !child.stdout) {
      throw new Error('ChildAcpProcessHost: failed to spawn process - no stdio streams');
    }
    return new ChildProcessHandle(child, platform);
  }

  async spawnTerminal(spec: {
    command: string;
    args: string[];
    env: Record<string, string>;
    cwd: string;
  }): Promise<AcpTerminalProcess> {
    const platform = this.options.platform ?? process.platform;
    const plan = planExecutableLaunch({
      platform,
      command: spec.command,
      args: spec.args,
      cwd: spec.cwd,
      env: spec.env,
      fileExists: this.options.fileExists,
    });
    recordSpawn('agent', plan.executable);
    const child = spawn(plan.executable, plan.args, {
      cwd: plan.cwd,
      detached: platform !== 'win32',
      env: spec.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsVerbatimArguments: plan.windowsVerbatimArguments,
    });
    if (!child.stdout) {
      throw new Error('ChildAcpProcessHost: failed to spawn terminal - no stdout stream');
    }
    return new ChildTerminalProcess(child, platform);
  }
}
