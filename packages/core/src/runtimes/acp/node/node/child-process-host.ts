import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { recordSpawn } from '@emdash/shared/perf';
import type { CommandSpec } from '#primitives/exec/api';
import {
  createChildProcessTreeTerminator,
  planExecutableLaunch,
  planShellLaunch,
  toChildProcessLaunch,
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

class ChildTerminalProcess implements AcpTerminalProcess {
  readonly ready: Promise<void>;
  private exitStatus: AcpTerminalExit | undefined;
  private error: Error | undefined;
  private readonly exitListeners: ((status: AcpTerminalExit) => void)[] = [];
  private readonly errorListeners: ((error: Error) => void)[] = [];
  private _exitCode: number | null = null;
  private readonly terminator: ProcessTreeTerminator;

  constructor(
    private readonly child: ReturnType<typeof spawn>,
    platform: NodeJS.Platform
  ) {
    this.terminator = createChildProcessTreeTerminator(child, {
      platform,
      processGroup: platform !== 'win32',
    });
    // Own errors before yielding, including failures before the caller has a handle.
    this.ready = new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.on('error', (error) => {
        this.error = error;
        reject(error);
        for (const listener of this.errorListeners) listener(error);
      });
    });
    // `close` follows stdio drainage; `exit` can precede the last output chunk.
    child.once('close', (code, signal) => {
      this._exitCode = code;
      this.exitStatus = { exitCode: code, signal: signal ?? null };
      for (const listener of this.exitListeners) listener(this.exitStatus);
    });
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
    this.exitListeners.push(cb);
    if (this.exitStatus) cb(this.exitStatus);
  }

  onError(cb: (err: Error) => void): void {
    this.errorListeners.push(cb);
    if (this.error) cb(this.error);
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
    const launch = toChildProcessLaunch(plan.invocation);
    recordSpawn('agent', launch.executable);
    const child = spawn(launch.executable, launch.args, {
      cwd: plan.cwd,
      detached: platform !== 'win32',
      env: spec.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
    });
    if (!child.stdin || !child.stdout) {
      throw new Error('ChildAcpProcessHost: failed to spawn process - no stdio streams');
    }
    return new ChildProcessHandle(child, platform);
  }

  async spawnTerminal(spec: {
    command: CommandSpec;
    env: Record<string, string>;
    cwd: string;
  }): Promise<AcpTerminalProcess> {
    const platform = this.options.platform ?? process.platform;
    const invocation =
      spec.command.kind === 'shell-line'
        ? planShellLaunch({ platform, commandLine: spec.command.commandLine, env: spec.env })
        : planExecutableLaunch({
            platform,
            command: spec.command.command,
            args: spec.command.args,
            cwd: spec.cwd,
            env: spec.env,
            fileExists: this.options.fileExists,
          }).invocation;
    const launch = toChildProcessLaunch(invocation);
    recordSpawn('agent', launch.executable);
    const child = spawn(launch.executable, launch.args, {
      cwd: spec.cwd,
      detached: platform !== 'win32',
      env: spec.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
    });
    if (!child.stdout) {
      throw new Error('ChildAcpProcessHost: failed to spawn terminal - no stdout stream');
    }
    const terminal = new ChildTerminalProcess(child, platform);
    await terminal.ready;
    return terminal;
  }
}
