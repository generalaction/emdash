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
  const useEnv = {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'emdash',
    ...process.env,
    ...(env || {}),
  };

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

  // Detect if we're spawning a provider CLI - if so, spawn shell instead and inject CLI command
  let commandToInject: string | null = null;
  const args: string[] = [];
  let actualShell = useShell;
  
  if (process.platform !== 'win32') {
    try {
      const base = String(useShell).split('/').pop() || '';
      const baseLower = base.toLowerCase();
      const provider = PROVIDERS.find((p) => p.cli === baseLower);

      if (provider) {
        // Instead of spawning CLI directly, spawn user's shell and inject CLI command
        // This allows users to exit CLI and return to shell prompt
        actualShell = getDefaultShell();
        
        // Build the CLI command with all arguments
        const cliArgs: string[] = [];
        if (provider.defaultArgs?.length) {
          cliArgs.push(...provider.defaultArgs);
        }
        if (autoApprove && provider.autoApproveFlag) {
          cliArgs.push(provider.autoApproveFlag);
        }
        if (provider.initialPromptFlag !== undefined && initialPrompt?.trim()) {
          if (provider.initialPromptFlag) {
            cliArgs.push(provider.initialPromptFlag);
          }
          cliArgs.push(initialPrompt.trim());
        }
        
        // Build command string to inject: "claude --args..." or escape properly
        const cliCommand = provider.cli || base;
        const argsStr = cliArgs.length > 0 ? ' ' + cliArgs.map(arg => {
          // Escape shell arguments properly
          // Single quotes are the safest - they prevent all shell interpretation
          // Replace single quotes with: ' (end quote) + \' (escaped quote) + ' (start quote)
          if (/[\s'"\\$`\n\r\t]/.test(arg)) {
            return `'${String(arg).replace(/'/g, "'\\''")}'`;
          }
          return String(arg);
        }).join(' ') : '';
        commandToInject = cliCommand + argsStr + '\r';
        
        // Use interactive shell args
        const shellBase = actualShell.split('/').pop() || '';
        if (shellBase === 'zsh') args.push('-il');
        else if (shellBase === 'bash') args.push('-il');
        else if (shellBase === 'fish') args.push('-il');
        else if (shellBase === 'sh') args.push('-il');
        else args.push('-i'); // Fallback for other shells
      } else {
        // For normal shells, use login + interactive to load user configs
        if (baseLower === 'zsh') args.push('-il');
        else if (baseLower === 'bash') args.push('-il');
        else if (baseLower === 'fish') args.push('-il');
        else if (baseLower === 'sh') args.push('-il');
        else args.push('-i'); // Fallback for other shells
      }
    } catch {}
  }

  let proc: IPty;
  try {
    proc = pty.spawn(actualShell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: useCwd,
      env: useEnv,
    });
    
    // If we have a command to inject (provider CLI), inject it after a short delay
    // This gives the shell time to initialize and show prompt
    if (commandToInject) {
      const cmdToInject = commandToInject; // Capture for closure
      setTimeout(() => {
        try {
          // Verify PTY still exists and is alive before writing
          const rec = ptys.get(id);
          if (!rec || rec.proc !== proc) {
            log.debug('ptyManager:injectSkipped', { id, reason: 'PTY no longer exists' });
            return;
          }
          // TypeScript: cmdToInject is guaranteed non-null here due to outer if check
          proc.write(cmdToInject);
          log.debug('ptyManager:injectedCommand', { id, command: cmdToInject.trim() });
        } catch (err: any) {
          // PTY might have exited - this is expected and safe to ignore
          const errorMsg = err?.message || String(err);
          if (errorMsg.includes('not open') || errorMsg.includes('EBADF')) {
            log.debug('ptyManager:injectSkipped', { id, reason: 'PTY already closed' });
          } else {
            log.warn('ptyManager:injectFailed', { id, error: errorMsg });
          }
        }
      }, 300); // 300ms delay to allow shell to initialize
    }
    
    log.debug('ptyManager:spawned', { 
      id, 
      shell: actualShell, 
      originalShell: useShell,
      args, 
      cwd: useCwd,
      injectingCommand: commandToInject ? commandToInject.trim() : null
    });
  } catch (err: any) {
    try {
      const fallbackShell = getDefaultShell();
      // If original spawn failed, don't inject command (fallback is for emergency recovery)
      commandToInject = null;
      proc = pty.spawn(fallbackShell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: useCwd,
        env: useEnv,
      });
      log.debug('ptyManager:spawnedFallback', { id, shell: fallbackShell, cwd: useCwd });
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
