import os from 'os';
// Important: only import node-pty types, not the runtime module, at load time.
// Lazy-require the native module inside startPty to avoid app-start crashes
// when the native binary is missing or incompatible on some systems.
import type { IPty } from 'node-pty';
import { log } from '../lib/logger';

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

  let useShell = shell || getDefaultShell();
  const useCwd = cwd || process.cwd() || os.homedir();
  const useEnv = { TERM: 'xterm-256color', ...process.env, ...(env || {}) };

  // On Windows, resolve shell command to full path for node-pty
  if (process.platform === 'win32' && shell && !shell.includes('\\') && !shell.includes('/')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { execSync } = require('child_process');

      // Try .cmd first (npm globals are typically .cmd files)
      let resolved = '';
      try {
        resolved = execSync(`where ${shell}.cmd`, { encoding: 'utf8' })
          .trim()
          .split('\n')[0]
          .replace(/\r/g, '')
          .trim();
      } catch {
        // If .cmd doesn't exist, try without extension
        resolved = execSync(`where ${shell}`, { encoding: 'utf8' })
          .trim()
          .split('\n')[0]
          .replace(/\r/g, '')
          .trim();
      }

      // Ensure we have an executable extension
      if (resolved && !resolved.match(/\.(exe|cmd|bat)$/i)) {
        // If no executable extension, try appending .cmd
        const cmdPath = resolved + '.cmd';
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const fs = require('fs');
          if (fs.existsSync(cmdPath)) {
            resolved = cmdPath;
          }
        } catch {
          // Ignore fs errors
        }
      }

      if (resolved) {
        useShell = resolved;
      }
    } catch {
      // Fall back to original shell name
    }
  }

  // Lazy load native module at call time to prevent startup crashes
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pty: typeof import('node-pty') = require('node-pty');

  // Provide sensible defaults for interactive shells so they render prompts
  const args: string[] = [];
  if (process.platform !== 'win32') {
    try {
      const base = String(useShell).split('/').pop() || '';
      if (base === 'zsh') args.push('-il');
      else if (base === 'bash') args.push('--noprofile', '--norc', '-i');
      else if (base === 'fish' || base === 'sh') args.push('-i');
      // Do not add args for known CLI binaries like codex/claude
      if (/^(codex|claude)$/i.test(base)) args.length = 0;
    } catch {}
  }

  const proc = pty.spawn(useShell, args, {
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
  if (!rec) {
    log.warn('ptyManager:writeMissing', { id, bytes: data.length });
    return;
  }
  rec.proc.write(data);
}

export function resizePty(id: string, cols: number, rows: number): void {
  const rec = ptys.get(id);
  if (!rec) {
    log.warn('ptyManager:resizeMissing', { id, cols, rows });
    return;
  }
  try {
    rec.proc.resize(cols, rows);
  } catch (error: any) {
    // EBADF typically means the PTY has already exited; swallow and log once
    if (error && (error.code === 'EBADF' || /EBADF/.test(String(error)))) {
      log.warn('ptyManager:resizeAfterExit', { id, cols, rows });
      return;
    }
    throw error;
  }
}

export function killPty(id: string): void {
  const rec = ptys.get(id);
  if (!rec) {
    log.warn('ptyManager:killMissing', { id });
    return;
  }
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
