import os from 'os';
import fs from 'fs';
import path from 'path';
import type { IPty } from 'node-pty';
import { log } from '../lib/logger';
import { PROVIDERS } from '@shared/providers/registry';
import { providerStatusCache } from './providerStatusCache';
import { errorTracking } from '../errorTracking';
import { getProviderCustomConfig } from '../settings';

/**
 * Environment variables to pass through for agent authentication.
 * These are passed to CLI tools during direct spawn (which skips shell config).
 */
const AGENT_ENV_VARS = [
  'AMP_API_KEY',
  'ANTHROPIC_API_KEY',
  'AUGMENT_SESSION_AUTH',
  'AWS_ACCESS_KEY_ID',
  'AWS_DEFAULT_REGION',
  'AWS_PROFILE',
  'AWS_REGION',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AZURE_OPENAI_API_ENDPOINT',
  'AZURE_OPENAI_API_KEY',
  'CODEBUFF_API_KEY',
  'COPILOT_CLI_TOKEN',
  'CURSOR_API_KEY',
  'DASHSCOPE_API_KEY',
  'FACTORY_API_KEY',
  'GEMINI_API_KEY',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GOOGLE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_CLOUD_PROJECT',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'KIMI_API_KEY',
  'MISTRAL_API_KEY',
  'MOONSHOT_API_KEY',
  'NO_PROXY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
];

type PtyRecord = {
  id: string;
  proc: IPty;
  cwd?: string; // Working directory (for respawning shell after CLI exit)
  isDirectSpawn?: boolean; // Whether this was a direct CLI spawn
};

const ptys = new Map<string, PtyRecord>();

/**
 * Parse a shell-style argument string into an array of arguments.
 * Handles single quotes, double quotes, and escape characters.
 *
 * Examples:
 *   '--flag1 --flag2' → ['--flag1', '--flag2']
 *   '--message "hello world"' → ['--message', 'hello world']
 *   "--path '/my dir/file'" → ['--path', '/my dir/file']
 *   '--arg "say \"hi\""' → ['--arg', 'say "hi"']
 */
function parseShellArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escape = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (escape) {
      // Handle escaped character
      current += char;
      escape = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      // Backslash escapes next character (except inside single quotes)
      escape = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      // Toggle single quote mode
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      // Toggle double quote mode
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
      // Space outside quotes - end of argument
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  // Don't forget the last argument
  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

// Callback to spawn shell after direct CLI exits (set by ptyIpc)
let onDirectCliExitCallback: ((id: string, cwd: string) => void) | null = null;

export function setOnDirectCliExit(callback: (id: string, cwd: string) => void): void {
  onDirectCliExitCallback = callback;
}

/**
 * Spawn a CLI directly without a shell wrapper.
 * This is faster because it skips shell config loading (oh-my-zsh, nvm, etc.)
 *
 * Returns null if the CLI path is not known (not in providerStatusCache).
 */
export function startDirectPty(options: {
  id: string;
  providerId: string;
  cwd: string;
  cols?: number;
  rows?: number;
  autoApprove?: boolean;
  initialPrompt?: string;
  resume?: boolean;
}): IPty | null {
  if (process.env.EMDASH_DISABLE_PTY === '1') {
    throw new Error('PTY disabled via EMDASH_DISABLE_PTY=1');
  }

  const {
    id,
    providerId,
    cwd,
    cols = 120,
    rows = 32,
    autoApprove,
    initialPrompt,
    resume,
  } = options;

  // Get the CLI path from cache
  const status = providerStatusCache.get(providerId);
  if (!status?.installed || !status?.path) {
    log.warn('ptyManager:directSpawn - CLI path not found', { providerId });
    return null;
  }

  const cliPath = status.path;
  const provider = PROVIDERS.find((p) => p.id === providerId);

  // Build CLI arguments
  const cliArgs: string[] = [];

  if (provider) {
    // Add resume flag if resuming an existing session (e.g., after app reload)
    if (resume && provider.resumeFlag) {
      const resumeParts = provider.resumeFlag.split(' ');
      cliArgs.push(...resumeParts);
    }

    // Add default args
    if (provider.defaultArgs?.length) {
      cliArgs.push(...provider.defaultArgs);
    }

    // Add auto-approve flag
    if (autoApprove && provider.autoApproveFlag) {
      cliArgs.push(provider.autoApproveFlag);
    }

    // Add initial prompt
    if (provider.initialPromptFlag !== undefined && initialPrompt?.trim()) {
      if (provider.initialPromptFlag) {
        cliArgs.push(provider.initialPromptFlag);
      }
      cliArgs.push(initialPrompt.trim());
    }
  }

  // Build minimal environment - just what the CLI needs
  const useEnv: Record<string, string> = {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'emdash',
    HOME: process.env.HOME || os.homedir(),
    USER: process.env.USER || os.userInfo().username,
    // Include PATH so CLI can find its dependencies
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    ...(process.env.LANG && { LANG: process.env.LANG }),
    ...(process.env.SSH_AUTH_SOCK && { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK }),
  };

  // Pass through agent authentication env vars
  for (const key of AGENT_ENV_VARS) {
    if (process.env[key]) {
      useEnv[key] = process.env[key];
    }
  }

  // Lazy load native module
  let pty: typeof import('node-pty');
  try {
    pty = require('node-pty');
  } catch (e: any) {
    throw new Error(`PTY unavailable: ${e?.message || String(e)}`);
  }

  const proc = pty.spawn(cliPath, cliArgs, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: useEnv,
  });

  // Store record with cwd for shell respawn after CLI exits
  ptys.set(id, { id, proc, cwd, isDirectSpawn: true });

  // When CLI exits, spawn a shell so user can continue working
  proc.onExit(() => {
    const rec = ptys.get(id);
    if (rec?.isDirectSpawn && rec.cwd && onDirectCliExitCallback) {
      // Spawn shell immediately after CLI exits
      onDirectCliExitCallback(id, rec.cwd);
    }
  });

  return proc;
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
        // Get custom config if available
        const customConfig = getProviderCustomConfig(provider.id);

        // Resolve values: custom config overrides provider defaults
        // Empty string means "disabled", undefined means "use default"
        // For CLI specifically, empty string falls back to default (can't have empty CLI)
        const resolvedCli =
          customConfig?.cli !== undefined && customConfig.cli !== ''
            ? customConfig.cli
            : provider.cli || baseLower;
        const resolvedResumeFlag =
          customConfig?.resumeFlag !== undefined ? customConfig.resumeFlag : provider.resumeFlag;
        const resolvedDefaultArgs =
          customConfig?.defaultArgs !== undefined
            ? parseShellArgs(customConfig.defaultArgs)
            : provider.defaultArgs;
        const resolvedAutoApproveFlag =
          customConfig?.autoApproveFlag !== undefined
            ? customConfig.autoApproveFlag
            : provider.autoApproveFlag;
        const resolvedInitialPromptFlag =
          customConfig?.initialPromptFlag !== undefined
            ? customConfig.initialPromptFlag
            : provider.initialPromptFlag;

        // Build the provider command with flags
        const cliArgs: string[] = [];

        // Add resume flag FIRST if available (unless skipResume is true)
        if (resolvedResumeFlag && !skipResume) {
          const resumeParts = parseShellArgs(resolvedResumeFlag);
          cliArgs.push(...resumeParts);
        }

        // Then add default args
        if (resolvedDefaultArgs?.length) {
          cliArgs.push(...resolvedDefaultArgs);
        }

        // Then auto-approve flag (parse shell-style in case of multiple flags or quoted values)
        if (autoApprove && resolvedAutoApproveFlag) {
          const autoApproveParts = parseShellArgs(resolvedAutoApproveFlag);
          cliArgs.push(...autoApproveParts);
        }

        // Finally initial prompt (parse shell-style in case of multiple flags or quoted values)
        if (resolvedInitialPromptFlag !== undefined && initialPrompt?.trim()) {
          if (resolvedInitialPromptFlag) {
            const promptFlagParts = parseShellArgs(resolvedInitialPromptFlag);
            cliArgs.push(...promptFlagParts);
          }
          cliArgs.push(initialPrompt.trim());
        }

        const cliCommand = resolvedCli;
        const commandString =
          cliArgs.length > 0
            ? `${cliCommand} ${cliArgs
                .map((arg) =>
                  /[\s'"\\$`\n\r\t]/.test(arg) ? `'${arg.replace(/'/g, "'\\''")}'` : arg
                )
                .join(' ')}`
            : cliCommand;

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

  ptys.set(id, { id, proc });
  return proc;
}

export function writePty(id: string, data: string): void {
  const rec = ptys.get(id);
  if (!rec) {
    return;
  }
  rec.proc.write(data);
}

export function resizePty(id: string, cols: number, rows: number): void {
  const rec = ptys.get(id);
  if (!rec) {
    // PTY not ready yet - this is normal during startup, ignore silently
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
      // Expected during shutdown - PTY already exited
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
