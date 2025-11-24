import { spawn, execFileSync } from 'child_process';
import { BrowserWindow } from 'electron';
import { providerStatusCache, type ProviderStatus } from './providerStatusCache';
import { listDetectableProviders, type ProviderDefinition } from '@shared/providers/registry';
import { log } from '../lib/logger';

export type CliStatusCode = 'connected' | 'missing' | 'needs_key' | 'error';

export interface CliProviderStatus {
  id: string;
  name: string;
  status: CliStatusCode;
  version?: string | null;
  message?: string | null;
  docUrl?: string | null;
  command?: string | null;
  installCommand?: string | null;
}

type CliDefinition = ProviderDefinition & {
  commands: string[];
  args: string[];
  statusResolver?: (result: CommandResult) => CliStatusCode;
  messageResolver?: (result: CommandResult) => string | null;
};

interface CommandResult {
  command: string;
  success: boolean;
  error?: Error;
  stdout: string;
  stderr: string;
  status: number | null;
  version: string | null;
  resolvedPath: string | null;
  timedOut?: boolean;
  timeoutMs?: number;
}

const truncate = (input: string, max = 400): string =>
  input && input.length > max ? `${input.slice(0, max)}…` : input;

const DEFAULT_TIMEOUT_MS = 3000;

export const CLI_DEFINITIONS: CliDefinition[] = listDetectableProviders().map((provider) => ({
  id: provider.id,
  name: provider.name,
  commands: provider.commands ?? [],
  args: provider.versionArgs ?? ['--version'],
  docUrl: provider.docUrl,
  installCommand: provider.installCommand,
  detectable: provider.detectable,
}));

class ConnectionsService {
  private initialized = false;
  private timeoutRetryPending = new Set<string>();
  private timeoutRetryTimers = new Map<string, NodeJS.Timeout>();

  private clearTimeoutRetry(providerId: string) {
    const pendingTimer = this.timeoutRetryTimers.get(providerId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.timeoutRetryTimers.delete(providerId);
    }
    this.timeoutRetryPending.delete(providerId);
  }

  async initProviderStatusCache() {
    if (this.initialized) return;
    this.initialized = true;
    await providerStatusCache.load();
    for (const def of CLI_DEFINITIONS) {
      // Always recheck on app start so stale cache entries get refreshed
      void this.checkProvider(def.id, 'bootstrap');
    }
  }

  getCachedProviderStatuses(): Record<string, ProviderStatus> {
    return providerStatusCache.getAll();
  }

  async checkProvider(
    providerId: string,
    reason: 'bootstrap' | 'manual' | 'timeout-retry' = 'manual',
    opts?: { timeoutMs?: number; allowRetry?: boolean }
  ) {
    const def = CLI_DEFINITIONS.find((d) => d.id === providerId);
    if (!def) return;

    if (reason !== 'timeout-retry' && this.timeoutRetryPending.has(providerId)) {
      // Cancel any pending timeout-based retry when a fresh check is requested.
      this.clearTimeoutRetry(providerId);
    }

    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const commandResult = await this.tryCommands(def, timeoutMs);
    const statusCode = await this.resolveStatus(def, commandResult);
    this.cacheStatus(def.id, commandResult, statusCode);
    // Only log errors or failed checks to reduce noise
    if (statusCode !== 'connected' || commandResult.error) {
      log.debug('provider:check', {
        providerId: def.id,
        status: statusCode,
        command: commandResult.command,
        resolvedPath: commandResult.resolvedPath,
        success: commandResult.success,
        version: commandResult.version,
        exitStatus: commandResult.status,
        stderr: commandResult.stderr ? truncate(commandResult.stderr) : null,
        stdout: commandResult.stdout ? truncate(commandResult.stdout) : null,
        error: commandResult.error
          ? String(commandResult.error?.message || commandResult.error)
          : null,
        pathEnvContainsNvm: process.env.PATH?.includes('.nvm/versions'),
        timedOut: commandResult.timedOut === true,
        timeoutMs,
        reason,
      });
    }

    const shouldRetryTimeout =
      commandResult.timedOut &&
      (commandResult.resolvedPath || commandResult.stdout) &&
      opts?.allowRetry !== false;
    if (shouldRetryTimeout && !this.timeoutRetryPending.has(providerId)) {
      this.timeoutRetryPending.add(providerId);
      const retryDelayMs = 1500;
      const retryTimeoutMs = Math.max(timeoutMs * 2, 12000);
      const retryTimer = setTimeout(() => {
        this.timeoutRetryTimers.delete(providerId);
        void this.checkProvider(providerId, 'timeout-retry', {
          timeoutMs: retryTimeoutMs,
          allowRetry: false,
        }).finally(() => this.timeoutRetryPending.delete(providerId));
      }, retryDelayMs);
      this.timeoutRetryTimers.set(providerId, retryTimer);
    }
  }

  async refreshAllProviderStatuses(): Promise<Record<string, ProviderStatus>> {
    log.info('provider:refreshAll:start');
    await Promise.all(
      CLI_DEFINITIONS.map((definition) => this.checkProvider(definition.id, 'manual'))
    );
    log.info('provider:refreshAll:done');
    return this.getCachedProviderStatuses();
  }

  private async resolveStatus(def: CliDefinition, result: CommandResult): Promise<CliStatusCode> {
    if (def.statusResolver) {
      return def.statusResolver(result);
    }

    if (result.timedOut && (result.resolvedPath || result.stdout)) {
      // CLI responded or was found, but took too long (e.g., self-updating). Treat as present.
      return 'connected';
    }

    if (result.success) {
      return 'connected';
    }

    return result.error ? 'error' : 'missing';
  }

  private resolveMessage(
    def: CliDefinition,
    result: CommandResult,
    status: CliStatusCode
  ): string | null {
    if (def.id === 'codex') {
      return status === 'connected'
        ? null
        : 'Codex CLI not detected. Install @openai/codex to enable Codex agents.';
    }

    if (def.messageResolver) {
      return def.messageResolver(result);
    }

    if (status === 'missing') {
      return `${def.name} was not found in PATH.`;
    }

    if (status === 'error') {
      if (result.stderr.trim()) {
        return result.stderr.trim();
      }
      if (result.stdout.trim()) {
        return result.stdout.trim();
      }
      if (result.error) {
        return result.error.message;
      }
    }

    return null;
  }

  private async tryCommands(def: CliDefinition, timeoutMs: number): Promise<CommandResult> {
    for (const command of def.commands) {
      const result = await this.runCommand(command, def.args ?? ['--version'], timeoutMs);
      if (result.success) {
        return result;
      }

      // If the command exists but returned a non-zero status, still return result for diagnostics
      if (result.error && (result.error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return result;
      }
    }

    // Return the last attempted command (or default) as missing
    return this.runCommand(
      def.commands[def.commands.length - 1],
      def.args ?? ['--version'],
      timeoutMs
    );
  }

  private async runCommand(
    command: string,
    args: string[],
    timeoutMs: number
  ): Promise<CommandResult> {
    const resolvedPath = this.resolveCommandPath(command);
    return new Promise((resolve) => {
      try {
        const child = spawn(command, args);

        let stdout = '';
        let stderr = '';
        let didTimeout = false;

        // timeout for version checks (some CLIs can start slowly)
        const timeoutId = setTimeout(() => {
          didTimeout = true;
          child.kill();
        }, timeoutMs);

        child.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        child.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        child.on('error', (error) => {
          clearTimeout(timeoutId);
          resolve({
            command,
            success: false,
            error,
            stdout: stdout || '',
            stderr: stderr || '',
            status: null,
            version: null,
            resolvedPath,
            timedOut: didTimeout,
            timeoutMs,
          });
        });

        child.on('close', (code) => {
          clearTimeout(timeoutId);

          const success = !didTimeout && code === 0;
          const version = this.extractVersion(stdout) || this.extractVersion(stderr);

          resolve({
            command,
            success,
            error: didTimeout ? new Error('Command timeout') : undefined,
            stdout,
            stderr,
            status: code,
            version,
            resolvedPath,
            timedOut: didTimeout,
            timeoutMs,
          });
        });
      } catch (error) {
        resolve({
          command,
          success: false,
          error: error as Error,
          stdout: '',
          stderr: '',
          status: null,
          version: null,
          resolvedPath,
          timedOut: false,
          timeoutMs,
        });
      }
    });
  }

  private extractVersion(output: string): string | null {
    if (!output) return null;
    const matches = output.match(/\d+\.\d+(\.\d+)?/);
    return matches ? matches[0] : null;
  }

  private resolveCommandPath(command: string): string | null {
    const resolver = process.platform === 'win32' ? 'where' : 'which';
    try {
      const result = execFileSync(resolver, [command], { encoding: 'utf8' });
      const lines = result
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      return lines[0] ?? null;
    } catch {
      return null;
    }
  }

  private cacheStatus(providerId: string, result: CommandResult, statusCode: CliStatusCode) {
    const installed = statusCode === 'connected';
    const status: ProviderStatus = {
      installed,
      path: result.resolvedPath,
      version: result.version,
      lastChecked: Date.now(),
    };
    providerStatusCache.set(providerId, status);
    this.emitStatusUpdate(providerId, status);
  }

  private emitStatusUpdate(providerId: string, status: ProviderStatus) {
    const payload = { providerId, status };
    BrowserWindow.getAllWindows().forEach((win) => {
      try {
        win.webContents.send('provider:status-updated', payload);
      } catch {
        // ignore send errors
      }
    });
  }
}

export const connectionsService = new ConnectionsService();
