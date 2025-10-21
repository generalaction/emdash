import os from 'os';
// Important: only import node-pty types, not the runtime module, at load time.
// Lazy-require the native module inside startPty to avoid app-start crashes
// when the native binary is missing or incompatible on some systems.
import type { IPty } from 'node-pty';

type PtyRecord = {
  id: string;
  proc: IPty;
};

const ptys = new Map<string, PtyRecord>();

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    // Prefer ComSpec (usually cmd.exe) or fallback to PowerShell
    return process.env.ComSpec || 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

export function startPty(options: {
  id: string;
  cwd?: string;
  shell?: string;
  env?: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
}): IPty {
  const { id, cwd, shell, env, cols = 80, rows = 24 } = options;

  const useShell = shell || getDefaultShell();
  const useCwd = cwd || process.cwd() || os.homedir();
  const useEnv = { TERM: 'xterm-256color', ...process.env, ...(env || {}) };

  // Lazy load native module at call time to prevent startup crashes
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pty: typeof import('node-pty') = require('node-pty');

  const proc = pty.spawn(useShell, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: useCwd,
    env: useEnv,
  });

  const rec: PtyRecord = { id, proc };
  ptys.set(id, rec);
  return proc;
}

export function writePty(id: string, data: string): void {
  const rec = ptys.get(id);
  if (!rec) return;
  rec.proc.write(data);
}

export function resizePty(id: string, cols: number, rows: number): void {
  const rec = ptys.get(id);
  if (!rec) return;
  rec.proc.resize(cols, rows);
}

export function killPty(id: string): void {
  const rec = ptys.get(id);
  if (!rec) return;
  try {
    rec.proc.kill();
  } finally {
    ptys.delete(id);
  }
}

export function hasPty(id: string): boolean {
  return ptys.has(id);
}

export function getPty(id: string): IPty | undefined {
  return ptys.get(id)?.proc;
}
