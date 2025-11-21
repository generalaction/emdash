import { spawn, execFileSync } from 'child_process';
import { BrowserWindow } from 'electron';
import { providerStatusCache, type ProviderStatus } from './providerStatusCache';

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

interface CliDefinition {
  id: string;
  name: string;
  commands: string[];
  args?: string[];
  docUrl?: string;
  installCommand?: string;
  statusResolver?: (result: CommandResult) => CliStatusCode;
  messageResolver?: (result: CommandResult) => string | null;
}

interface CommandResult {
  command: string;
  success: boolean;
  error?: Error;
  stdout: string;
  stderr: string;
  status: number | null;
  version: string | null;
  resolvedPath: string | null;
}

export const CLI_DEFINITIONS: CliDefinition[] = [
  {
    id: 'codex',
    name: 'Codex',
    commands: ['codex'],
    args: ['--version'],
    docUrl: 'https://github.com/openai/codex',
    installCommand: 'npm install -g @openai/codex',
  },
  {
    id: 'claude',
    name: 'Claude Code',
    commands: ['claude'],
    args: ['--version'],
    docUrl: 'https://docs.anthropic.com/claude/docs/claude-code',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    commands: ['cursor-agent', 'cursor'],
    args: ['--version'],
    docUrl: 'https://cursor.sh',
    installCommand: 'curl https://cursor.com/install -fsS | bash',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    commands: ['gemini'],
    args: ['--version'],
    docUrl: 'https://github.com/google-gemini/gemini-cli',
    installCommand: 'npm install -g @google/gemini-cli',
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    commands: ['qwen'],
    args: ['--version'],
    docUrl: 'https://github.com/QwenLM/qwen-code',
    installCommand: 'npm install -g @qwen-code/qwen-code',
  },
  {
    id: 'droid',
    name: 'Droid',
    commands: ['droid'],
    args: ['--version'],
    docUrl: 'https://docs.factory.ai/cli/getting-started/quickstart',
    installCommand: 'curl -fsSL https://app.factory.ai/cli | sh',
  },
  {
    id: 'amp',
    name: 'Amp',
    commands: ['amp'],
    args: ['--version'],
    docUrl: 'https://ampcode.com/manual#install',
    installCommand: 'npm install -g @sourcegraph/amp@latest',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    commands: ['opencode'],
    args: ['--version'],
    docUrl: 'https://opencode.ai/docs/cli/',
    installCommand: 'npm install -g opencode-ai',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    commands: ['copilot'],
    args: ['--version'],
    docUrl: 'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli',
    installCommand: 'npm install -g @github/copilot',
  },
  {
    id: 'charm',
    name: 'Charm',
    commands: ['crush'],
    args: ['--version'],
    docUrl: 'https://github.com/charmbracelet/crush',
    installCommand: 'npm install -g @charmland/crush',
  },
  {
    id: 'auggie',
    name: 'Auggie',
    commands: ['auggie'],
    args: ['--version'],
    docUrl: 'https://docs.augmentcode.com/cli/overview',
    installCommand: 'npm install -g @augmentcode/auggie',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    commands: ['kimi'],
    args: ['--help'],
    docUrl: 'https://www.kimi.com/coding/docs/en/kimi-cli.html',
    installCommand: 'uv tool install --python 3.13 kimi-cli',
  },
  {
    id: 'kiro',
    name: 'Kiro (AWS)',
    commands: ['kiro-cli', 'kiro'],
    args: ['--version'],
    docUrl: 'https://kiro.dev/docs/cli/',
    installCommand: 'curl -fsSL https://cli.kiro.dev/install | bash',
  },
  {
    id: 'rovo',
    name: 'Rovo Dev (Atlassian)',
    commands: ['rovodev', 'acli'],
    args: ['--version'],
    docUrl: 'https://support.atlassian.com/rovo/docs/install-and-run-rovo-dev-cli-on-your-device/',
    installCommand: 'acli rovodev auth login',
  },
];

class ConnectionsService {
  private initialized = false;

  async initProviderStatusCache() {
    if (this.initialized) return;
    this.initialized = true;
    await providerStatusCache.load();
    for (const def of CLI_DEFINITIONS) {
      const entry = providerStatusCache.get(def.id);
      if (!entry || typeof entry.installed !== 'boolean') {
        void this.checkProvider(def.id, 'bootstrap');
      }
    }
  }

  getCachedProviderStatuses(): Record<string, ProviderStatus> {
    return providerStatusCache.getAll();
  }

  async checkProvider(providerId: string, _reason: 'bootstrap' | 'manual' = 'manual') {
    const def = CLI_DEFINITIONS.find((d) => d.id === providerId);
    if (!def) return;
    const commandResult = await this.tryCommands(def);
    const statusCode = await this.resolveStatus(def, commandResult);
    this.cacheStatus(def.id, commandResult, statusCode);
  }

  async refreshAllProviderStatuses(): Promise<Record<string, ProviderStatus>> {
    await Promise.all(
      CLI_DEFINITIONS.map((definition) => this.checkProvider(definition.id, 'manual'))
    );
    return this.getCachedProviderStatuses();
  }

  private async resolveStatus(def: CliDefinition, result: CommandResult): Promise<CliStatusCode> {
    if (def.statusResolver) {
      return def.statusResolver(result);
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

  private async tryCommands(def: CliDefinition): Promise<CommandResult> {
    for (const command of def.commands) {
      const result = await this.runCommand(command, def.args ?? ['--version']);
      if (result.success) {
        return result;
      }

      // If the command exists but returned a non-zero status, still return result for diagnostics
      if (result.error && (result.error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return result;
      }
    }

    // Return the last attempted command (or default) as missing
    return this.runCommand(def.commands[def.commands.length - 1], def.args ?? ['--version']);
  }

  private async runCommand(command: string, args: string[]): Promise<CommandResult> {
    const resolvedPath = this.resolveCommandPath(command);
    return new Promise((resolve) => {
      try {
        const child = spawn(command, args);

        let stdout = '';
        let stderr = '';
        let didTimeout = false;

        // timeout for version checks
        const timeoutId = setTimeout(() => {
          didTimeout = true;
          child.kill();
        }, 2000);

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
