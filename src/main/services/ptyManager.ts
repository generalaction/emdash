import { execFileSync } from 'child_process';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { extname } from 'node:path';
import type { IPty } from 'node-pty';
import { log } from '../lib/logger';
import { PROVIDERS } from '@shared/providers/registry';
import { errorTracking } from '../errorTracking';

type PtyRecord = {
  id: string;
  proc: IPty;
};

const ptys = new Map<string, PtyRecord>();

function resolveCliPath(command: string): string | null {
  const resolver = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = execFileSync(resolver, [command], { encoding: 'utf8' });
    const lines = result
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (process.platform !== 'win32') {
      return lines[0] ?? null;
    }

    // Prefer actual executable extensions on Windows (avoid extensionless shims like `%APPDATA%\\npm\\codex`).
    const extensionPreference: Record<string, number> = {
      '.exe': 0,
      '.cmd': 1,
      '.bat': 2,
      '.com': 3,
      '.ps1': 50,
      '': 100,
    };

    const best = [...lines].sort((a, b) => {
      const aExt = extname(a).toLowerCase();
      const bExt = extname(b).toLowerCase();
      const aRank = extensionPreference[aExt] ?? extensionPreference[''];
      const bRank = extensionPreference[bExt] ?? extensionPreference[''];
      return aRank - bRank;
    })[0];

    return best ?? null;
  } catch {
    return null;
  }
}

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    // Prefer ComSpec (usually cmd.exe) or fallback to PowerShell
    return process.env.ComSpec || 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

export async function startPty(options: {
  id: string;
  cwd?: string;
  shell?: string;
  env?: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
  autoApprove?: boolean;
  initialPrompt?: string;
  skipResume?: boolean;
}): Promise<IPty> {
  if (process.env.EMDASH_DISABLE_PTY === '1') {
    throw new Error('PTY disabled via EMDASH_DISABLE_PTY=1');
  }
  const {
    id,
    cwd,
    shell,
    env,
    cols = 80,
    rows = 24,
    autoApprove,
    initialPrompt,
    skipResume,
  } = options;

  const defaultShell = getDefaultShell();
  let useShell = shell || defaultShell;
  const useCwd = cwd || process.cwd() || os.homedir();

  // Build a clean environment instead of inheriting process.env wholesale.
  //
  // WHY: When Emdash runs as an AppImage on Linux (or other packaged Electron apps),
  // the parent process.env contains packaging artifacts like PYTHONHOME, APPDIR,
  // APPIMAGE, etc. These variables can break user tools, especially Python virtual
  // environments which fail with "Could not find platform independent libraries"
  // when PYTHONHOME points to the AppImage's bundled Python.
  //
  // SOLUTION: Only pass through essential variables and let login shells (-il)
  // rebuild the environment from the user's shell configuration files
  // (.profile, .bashrc, .zshrc, etc.). This is how `sudo -i`, `ssh`, and other
  // tools create clean user environments.
  //
  // See: https://github.com/generalaction/emdash/issues/485
  const useEnv: Record<string, string> = {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'emdash',
    HOME: process.env.HOME || os.homedir(),
    USER: process.env.USER || os.userInfo().username,
    SHELL: process.env.SHELL || defaultShell,
    ...(process.platform === 'win32' && {
      // Windows shells (.cmd/.bat) and many tools rely on PATH/PATHEXT to locate executables (e.g. `node`).
      PATH: process.env.PATH || process.env.Path || '',
      PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC',
      SystemRoot: process.env.SystemRoot || 'C:\\Windows',
      ComSpec: process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
      TEMP: process.env.TEMP || '',
      TMP: process.env.TMP || '',
      USERPROFILE: process.env.USERPROFILE || os.homedir(),
      APPDATA: process.env.APPDATA || '',
      LOCALAPPDATA: process.env.LOCALAPPDATA || '',
    }),
    ...(process.env.LANG && { LANG: process.env.LANG }),
    ...(process.env.DISPLAY && { DISPLAY: process.env.DISPLAY }),
    ...(process.env.SSH_AUTH_SOCK && { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK }),
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

  // Provide sensible defaults for interactive shells so they render prompts.
  // For provider CLIs, spawn the user's shell and run the provider command via -c,
  // then exec back into the shell to allow users to stay in a normal prompt after exiting the agent.
  const args: string[] = [];
  if (process.platform !== 'win32') {
    try {
      const base = String(useShell).split('/').pop() || '';
      const baseLower = base.toLowerCase();
      const provider = PROVIDERS.find((p) => p.cli === baseLower);

      if (provider) {
        // Build the provider command with flags
        const cliArgs: string[] = [];

        // Add resume flag FIRST if available (unless skipResume is true)
        if (provider.resumeFlag && !skipResume) {
          const resumeParts = provider.resumeFlag.split(' ');
          cliArgs.push(...resumeParts);
        }

        // Then add default args
        if (provider.defaultArgs?.length) {
          cliArgs.push(...provider.defaultArgs);
        }

        // Then auto-approve flag
        if (autoApprove && provider.autoApproveFlag) {
          cliArgs.push(provider.autoApproveFlag);
        }

        // Finally initial prompt
        if (provider.initialPromptFlag !== undefined && initialPrompt?.trim()) {
          if (provider.initialPromptFlag) {
            cliArgs.push(provider.initialPromptFlag);
          }
          cliArgs.push(initialPrompt.trim());
        }

        const cliCommand = provider.cli || baseLower;
        const resolvedCliPath = resolveCliPath(cliCommand);
        const finalCommand = resolvedCliPath || cliCommand;
        const quotedFinalCommand =
          /[\s'"\\$`\n\r\t]/.test(finalCommand) ? `'${finalCommand.replace(/'/g, "'\\''")}'` : finalCommand;
        const commandString =
          cliArgs.length > 0
            ? `${quotedFinalCommand} ${cliArgs
                .map((arg) =>
                  /[\s'"\\$`\n\r\t]/.test(arg) ? `'${arg.replace(/'/g, "'\\''")}'` : arg
                )
                .join(' ')}`
            : quotedFinalCommand;

        // After the provider exits, exec back into the user's shell (login+interactive)
        const resumeShell = `'${defaultShell.replace(/'/g, "'\\''")}' -il`;
        const chainCommand = `${commandString}; exec ${resumeShell}`;

        // Always use the default shell for the -c command to avoid re-detecting provider CLI
        useShell = defaultShell;
        const shellBase = defaultShell.split('/').pop() || '';
        if (shellBase === 'zsh') args.push('-lic', chainCommand);
        else if (shellBase === 'bash') args.push('-lic', chainCommand);
        else if (shellBase === 'fish') args.push('-ic', chainCommand);
        else if (shellBase === 'sh') args.push('-lc', chainCommand);
        else args.push('-c', chainCommand); // Fallback for other shells
      } else {
        // For normal shells, use login + interactive to load user configs
        if (base === 'zsh') args.push('-il');
        else if (base === 'bash') args.push('-il');
        else if (base === 'fish') args.push('-il');
        else if (base === 'sh') args.push('-il');
        else args.push('-i'); // Fallback for other shells
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
    // Track initial spawn error
    const provider = args.find((arg) => PROVIDERS.some((p) => p.cli === arg));
    await errorTracking.captureAgentSpawnError(err, shell || 'unknown', id, {
      cwd: useCwd,
      args: args.join(' '),
      provider: provider || undefined,
    });

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
      // Track the fallback spawn error as critical
      await errorTracking.captureCriticalError(err2, {
        operation: 'pty_spawn_fallback',
        service: 'ptyManager',
        error_type: 'spawn_error',
        shell: getDefaultShell(),
        original_error: err?.message,
      });
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
