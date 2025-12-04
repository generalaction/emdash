import os from 'os';
import type { IPty } from 'node-pty';
import { log } from '../lib/logger';
import { PROVIDERS } from '@shared/providers/registry';

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
  autoApprove?: boolean;
  initialPrompt?: string;
}): IPty {
  if (process.env.EMDASH_DISABLE_PTY === '1') {
    throw new Error('PTY disabled via EMDASH_DISABLE_PTY=1');
  }
  const { id, cwd, shell, env, cols = 80, rows = 24, autoApprove, initialPrompt } = options;

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
  let pty: typeof import('node-pty');
  try {
    pty = require('node-pty');
  } catch (e: any) {
    throw new Error(`PTY unavailable: ${e?.message || String(e)}`);
  }

  // Provide sensible defaults for interactive shells so they render prompts
  const args: string[] = [];
  if (process.platform !== 'win32') {
    try {
      const base = String(useShell).split('/').pop() || '';
      if (base === 'zsh') args.push('-il');
      else if (base === 'bash') args.push('--noprofile', '--norc', '-i');
      else if (base === 'fish' || base === 'sh') args.push('-i');

      const baseLower = base.toLowerCase();
      const provider = PROVIDERS.find((p) => p.cli === baseLower);

      if (provider) {
        args.length = 0;
        if (provider.defaultArgs?.length) {
          args.push(...provider.defaultArgs);
        }
        if (autoApprove && provider.autoApproveFlag) {
          args.push(provider.autoApproveFlag);
        }
        if (provider.initialPromptFlag !== undefined && initialPrompt?.trim()) {
          if (provider.initialPromptFlag) {
            args.push(provider.initialPromptFlag);
          }
          args.push(initialPrompt.trim());
        }
      }
    } catch {}
  }

  let proc: IPty;
  try {
    proc = pty.spawn(useShell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: useCwd,
      env: useEnv,
    });
    log.debug('ptyManager:spawned', { id, shell: useShell, args, cwd: useCwd });
  } catch (err: any) {
    try {
      const fallbackShell = getDefaultShell();
      proc = pty.spawn(fallbackShell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: useCwd,
        env: useEnv,
      });
    } catch (err2: any) {
      throw new Error(`PTY spawn failed: ${err2?.message || err?.message || String(err2 || err)}`);
    }
  }

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
    // EBADF or native errors typically mean the PTY has already exited
    if (
      error &&
      (error.code === 'EBADF' ||
        /EBADF/.test(String(error)) ||
        /Napi::Error/.test(String(error)) ||
        error.message?.includes('not open'))
    ) {
      log.warn('ptyManager:resizeAfterExit', { id, cols, rows, error: String(error) });
      return;
    }
    log.error('ptyManager:resizeFailed', { id, cols, rows, error: String(error) });
  }
}

export function killPty(id: string): void {
  const rec = ptys.get(id);
  if (!rec) {
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
