import path from 'node:path';
import * as nodePty from 'node-pty';
import type { IPty } from 'node-pty';
import { log } from '@main/lib/logger';
import { normalizeSignal } from './exit-signals';
import type { Pty, PtyDimensions, PtyExitInfo } from './pty';

export interface LocalSpawnOptions extends PtyDimensions {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

const MIN_COLS = 2;
const MIN_ROWS = 1;

export function spawnLocalPty(options: LocalSpawnOptions): LocalPtySession {
  const { id, command, args, cwd, env, cols, rows } = options;
  const spawnSpec = resolveWindowsPtySpawn(command, args);

  log.info('LocalPtySession:spawn', {
    id,
    command: spawnSpec.command,
    args: spawnSpec.args,
    cwd,
    cols,
    rows,
  });

  try {
    const proc = nodePty.spawn(spawnSpec.command, spawnSpec.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env,
    });
    return new LocalPtySession(id, proc);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to spawn PTY: ${message}`);
  }
}

export class LocalPtySession implements Pty {
  readonly id: string;

  constructor(
    id: string,
    private readonly proc: IPty
  ) {
    this.id = id;
  }

  write(data: string): void {
    this.proc.write(data);
  }

  resize(cols: number, rows: number): void {
    const c = Number.isFinite(cols) ? Math.max(MIN_COLS, Math.floor(cols)) : MIN_COLS;
    const r = Number.isFinite(rows) ? Math.max(MIN_ROWS, Math.floor(rows)) : MIN_ROWS;
    try {
      this.proc.resize(c, r);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/EBADF|ENOTTY|ioctl\(2\) failed|not open|Napi::Error/.test(msg)) {
        return;
      }
      log.error('LocalPtySession:resize failed', { cols: c, rows: r, error: msg });
    }
  }

  kill(): void {
    this.proc.kill();
  }

  onData(handler: (data: string) => void): void {
    this.proc.onData(handler);
  }

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.proc.onExit(({ exitCode, signal }) => {
      handler({ exitCode, signal: normalizeSignal(signal) });
    });
  }

  getPid(): number {
    return this.proc.pid;
  }
}

function resolveWindowsPtySpawn(
  command: string,
  args: string[]
): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command, args };

  const quoteForCmdExe = (input: string): string => {
    if (input.length === 0) return '""';
    if (!/[\s"^&|<>()%!]/.test(input)) return input;
    return `"${input
      .replace(/%/g, '%%')
      .replace(/!/g, '^!')
      .replace(/(["^&|<>()])/g, '^$1')}"`;
  };

  const ext = path.extname(command).toLowerCase();
  if (ext === '.cmd' || ext === '.bat') {
    const comspec = process.env.ComSpec || String.raw`C:\\Windows\\System32\\cmd.exe`;
    const fullCommandString = [command, ...args].map(quoteForCmdExe).join(' ');
    return { command: comspec, args: ['/d', '/s', '/c', fullCommandString] };
  }
  if (ext === '.ps1') {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', command, ...args],
    };
  }

  return { command, args };
}
