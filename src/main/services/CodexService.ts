import { spawn, exec, execFile, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { createWriteStream, existsSync, mkdirSync, WriteStream, readFileSync } from 'fs';
import path from 'path';
import { app } from 'electron';
import { databaseService } from './DatabaseService';
import { log } from '../lib/logger';

const execAsync = promisify(exec);

export interface CodexAgent {
  id: string;
  workspaceId: string;
  worktreePath: string;
  status: 'idle' | 'running' | 'error';
  lastMessage?: string;
  lastResponse?: string;
}

export interface CodexResponse {
  success: boolean;
  output?: string;
  error?: string;
  agentId: string;
}

export class CodexService extends EventEmitter {
  private agents: Map<string, CodexAgent> = new Map();
  private isCodexInstalled: boolean | null = null;
  private runningProcesses: Map<string, ChildProcess> = new Map();
  private streamLogWriters: Map<string, WriteStream> = new Map();
  private pendingCancellationLogs: Set<string> = new Set();
  // Track the active conversation for a workspace while a stream is running
  private activeConversations: Map<string, string> = new Map();

  /**
   * Resolve CLI args for Codex exec based on env vars.
   *
   * - If CODEX_DANGEROUSLY_BYPASS (or CODEX_SANDBOX_MODE=danger-full-access)
   *   is set, prefer the unified `--dangerously-bypass-approvals-and-sandbox` flag.
   * - Otherwise, pass `--sandbox <mode>` and optionally `--approval <policy>`.
   *
   * This keeps the default behavior safe (workspace-write) while enabling
   * power users to opt out explicitly.
   */
  private buildCodexExecArgs(message: string): string[] {
    const bypassEnv = (
      process.env.CODEX_DANGEROUSLY_BYPASS ||
      process.env.CODEX_DANGEROUSLY_BYPASS_APPROVALS_AND_SANDBOX ||
      ''
    )
      .trim()
      .toLowerCase();
    const sandboxEnv = (process.env.CODEX_SANDBOX_MODE || '').trim().toLowerCase();
    const approvalEnv = (process.env.CODEX_APPROVAL_POLICY || '').trim().toLowerCase();

    const truthy = (v: string) => v === '1' || v === 'true' || v === 'yes' || v === 'y';
    const bypass = truthy(bypassEnv) || sandboxEnv === 'danger-full-access';

    if (bypass) {
      return ['exec', '--dangerously-bypass-approvals-and-sandbox', message];
    }

    // sandbox mode fallback
    let sandbox: 'read-only' | 'workspace-write' = 'workspace-write';
    if (sandboxEnv === 'read-only' || sandboxEnv === 'workspace-write') {
      sandbox = sandboxEnv;
    }

    const args = ['exec', '--sandbox', sandbox] as string[];

    // Optional approval policy if explicitly provided
    switch (approvalEnv) {
      case 'never':
      case 'on-request':
      case 'on-failure':
      case 'untrusted':
      case 'auto':
        args.push('--approval', approvalEnv);
        break;
      default:
        // ignore invalid/empty
        break;
    }

    args.push(message);
    return args;
  }

  constructor() {
    super();
    this.checkCodexInstallation();
  }

  private getStreamLogPath(agent: CodexAgent): string {
    // Store logs outside the repo to avoid showing up in git status
    const userData = app.getPath('userData');
    // Group by workspace so multiple runs append consistently
    const dir = path.join(userData, 'logs', 'codex', agent.workspaceId);
    return path.join(dir, 'codex-stream.log');
  }

  /**
   * Return the current streaming tail for an active process, parsed from the log.
   * If no active process for the workspace, return empty string.
   */
  public getStreamInfo(workspaceId: string): { tail: string; startedAt?: string } {
    const isRunning = this.runningProcesses.has(workspaceId);
    if (!isRunning) return { tail: '' };

    const agent = Array.from(this.agents.values()).find((a) => a.workspaceId === workspaceId);
    if (!agent) return { tail: '' };

    try {
      const logPath = this.getStreamLogPath(agent);
      if (!existsSync(logPath)) return { tail: '' };

      let buf = readFileSync(logPath, 'utf8');
      let startedAt: string | undefined;
      const headerMatch = buf.match(/^=== Codex Stream\s+([^=\n]+?)\s*===/m);
      if (headerMatch && headerMatch[1]) {
        const iso = headerMatch[1].trim();
        if (!Number.isNaN(Date.parse(iso))) startedAt = new Date(iso).toISOString();
      }

      // Trim to last 200KB if very large
      if (buf.length > 200 * 1024) {
        buf = buf.slice(buf.length - 200 * 1024);
      }
      const marker = '--- Output ---';
      const idx = buf.lastIndexOf(marker);
      let tail = idx >= 0 ? buf.slice(idx + marker.length) : buf;
      tail = tail.replace(/^\s+/, '');
      tail = tail.replace(/\n\[(COMPLETE|CANCELLED)\][\s\S]*$/, '');
      return { tail, startedAt };
    } catch {
      return { tail: '' };
    }
  }

  /**
   * Return active conversation id for a running stream in this workspace, if any
   */
  public getActiveConversationId(workspaceId: string): string | undefined {
    return this.activeConversations.get(workspaceId);
  }

  private initializeStreamLog(workspaceId: string, agent: CodexAgent, prompt: string): void {
    const logPath = this.getStreamLogPath(agent);
    const directory = path.dirname(logPath);

    this.pendingCancellationLogs.delete(workspaceId);

    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true });
    }

    const existing = this.streamLogWriters.get(workspaceId);
    if (existing && !existing.destroyed) {
      existing.end();
    }

    const header = [
      `=== Codex Stream ${new Date().toISOString()} ===`,
      `Workspace ID: ${workspaceId}`,
      `Worktree: ${agent.worktreePath}`,
      'Prompt:',
      prompt,
      '',
      '--- Output ---',
      '',
    ].join('\n');

    const stream = createWriteStream(logPath, { flags: 'w', encoding: 'utf8' });
    stream.on('error', (error) => {
      console.error('Failed to write codex stream log:', error);
    });

    stream.write(header);
    this.streamLogWriters.set(workspaceId, stream);
  }

  private appendStreamLog(workspaceId: string, content: string): void {
    const writer = this.streamLogWriters.get(workspaceId);
    if (!writer || writer.destroyed) {
      return;
    }

    writer.write(content);
  }

  private finalizeStreamLog(workspaceId: string): void {
    this.pendingCancellationLogs.delete(workspaceId);

    const writer = this.streamLogWriters.get(workspaceId);
    if (!writer) {
      return;
    }

    if (!writer.destroyed) {
      writer.end();
    }

    this.streamLogWriters.delete(workspaceId);
  }

  /**
   * Check if Codex CLI is installed
   */
  private async checkCodexInstallation(): Promise<boolean> {
    try {
      await execAsync('codex --version');
      this.isCodexInstalled = true;
      log.info('Codex CLI is installed');
      return true;
    } catch (error) {
      this.isCodexInstalled = false;
      log.info('Codex CLI is not installed');
      return false;
    }
  }

  /**
   * Get installation status
   */
  public async getInstallationStatus(): Promise<boolean> {
    if (this.isCodexInstalled === null) {
      return await this.checkCodexInstallation();
    }
    return this.isCodexInstalled;
  }

  /**
   * Create a new Codex agent for a workspace
   */
  public async createAgent(workspaceId: string, worktreePath: string): Promise<CodexAgent> {
    const agentId = `agent-${workspaceId}-${Date.now()}`;

    const agent: CodexAgent = {
      id: agentId,
      workspaceId,
      worktreePath,
      status: 'idle',
    };

    this.agents.set(agentId, agent);
    log.info(`Created Codex agent ${agentId} for workspace ${workspaceId}`);

    return agent;
  }

  /**
   * Send message to a Codex agent with streaming output
   */
  public async sendMessageStream(
    workspaceId: string,
    message: string,
    conversationId?: string
  ): Promise<void> {
    // Find agent for this workspace

    const agent = Array.from(this.agents.values()).find((a) => a.workspaceId === workspaceId);

    if (!agent) {
      this.emit('codex:error', { workspaceId, error: 'No agent found for this workspace' });
      return;
    }

    if (!this.isCodexInstalled) {
      this.initializeStreamLog(workspaceId, agent, message);
      this.appendStreamLog(
        workspaceId,
        '\n[ERROR] Codex CLI is not installed. Please install it with: npm install -g @openai/codex\n'
      );
      this.finalizeStreamLog(workspaceId);
      this.emit('codex:error', {
        workspaceId,
        error: 'Codex CLI is not installed. Please install it with: npm install -g @openai/codex',
      });
      return;
    }

    // If a stream is already running for this workspace, stop it first
    if (this.runningProcesses.has(workspaceId)) {
      await this.stopMessageStream(workspaceId);
    }

    // Update agent status
    agent.status = 'running';
    agent.lastMessage = message;
    // reset accumulated response for this new run
    agent.lastResponse = '';
    if (conversationId) {
      this.activeConversations.set(workspaceId, conversationId);
    } else {
      this.activeConversations.delete(workspaceId);
    }

    try {
      // Spawn codex directly with args to avoid shell quoting issues (backticks, quotes, etc.)
      const args = this.buildCodexExecArgs(message);
      log.info(
        `Executing: codex ${args.map((a) => (a.includes(' ') ? '"' + a + '"' : a)).join(' ')} in ${agent.worktreePath}`
      );

      this.initializeStreamLog(workspaceId, agent, message);
      const child = spawn('codex', args, {
        cwd: agent.worktreePath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.runningProcesses.set(workspaceId, child);

      // Stream stdout
      child.stdout.on('data', (data) => {
        const output = data.toString();
        this.appendStreamLog(workspaceId, output);
        agent.lastResponse = (agent.lastResponse || '') + output;
        const convId = this.activeConversations.get(workspaceId);
        this.emit('codex:output', {
          workspaceId,
          output,
          agentId: agent.id,
          conversationId: convId,
        });
      });

      // Stream stderr
      child.stderr.on('data', (data) => {
        const error = data.toString();
        this.appendStreamLog(workspaceId, `\n[ERROR] ${error}\n`);
        const convId = this.activeConversations.get(workspaceId);
        this.emit('codex:error', { workspaceId, error, agentId: agent.id, conversationId: convId });
      });

      // Handle completion
      child.on('close', async (code) => {
        this.runningProcesses.delete(workspaceId);
        agent.status = 'idle';
        log.info(`Codex completed with code ${code} in ${agent.worktreePath}`);
        const exitCode = code !== null && code !== undefined ? code : 'null';
        this.appendStreamLog(workspaceId, `\n[COMPLETE] exit code ${exitCode}\n`);
        if (!this.pendingCancellationLogs.has(workspaceId)) {
          this.finalizeStreamLog(workspaceId);
        }
        // Persist final agent message even if UI isn't mounted
        let emitConvId: string | undefined;
        try {
          const convId = this.activeConversations.get(workspaceId);
          const raw = (agent.lastResponse || '').trim();
          if (convId && raw) {
            await databaseService.saveMessage({
              id: `agent-${Date.now()}`,
              conversationId: convId,
              content: raw,
              sender: 'agent',
              metadata: JSON.stringify({ workspaceId, isStreaming: true }),
            });
          }
          emitConvId = convId;
        } catch (e) {
          console.error('Failed to persist agent message on complete:', e);
        } finally {
          this.activeConversations.delete(workspaceId);
        }
        this.emit('codex:complete', {
          workspaceId,
          exitCode: code,
          agentId: agent.id,
          conversationId: emitConvId,
        });
      });

      // Handle errors
      child.on('error', (error) => {
        agent.status = 'error';
        console.error(`Error executing Codex in ${agent.worktreePath}:`, error.message);
        this.runningProcesses.delete(workspaceId);
        this.appendStreamLog(workspaceId, `\n[ERROR] ${error.message}\n`);
        this.pendingCancellationLogs.delete(workspaceId);
        this.finalizeStreamLog(workspaceId);
        const convId = this.activeConversations.get(workspaceId);
        this.emit('codex:error', {
          workspaceId,
          error: error.message,
          agentId: agent.id,
          conversationId: convId,
        });
        this.activeConversations.delete(workspaceId);
      });
    } catch (error: any) {
      agent.status = 'error';
      console.error(`Error executing Codex in ${agent.worktreePath}:`, error.message);
      this.runningProcesses.delete(workspaceId);
      this.appendStreamLog(workspaceId, `\n[ERROR] ${error.message}\n`);
      this.pendingCancellationLogs.delete(workspaceId);
      this.finalizeStreamLog(workspaceId);
      const convId = this.activeConversations.get(workspaceId);
      this.emit('codex:error', {
        workspaceId,
        error: error.message,
        agentId: agent.id,
        conversationId: convId,
      });
      this.activeConversations.delete(workspaceId);
    }
  }

  public async stopMessageStream(workspaceId: string): Promise<boolean> {
    const process = this.runningProcesses.get(workspaceId);
    if (!process) {
      console.log('[CodexService] stopMessageStream: no running process for', workspaceId);
      this.pendingCancellationLogs.delete(workspaceId);
      return true;
    }

    const agent = Array.from(this.agents.values()).find((a) => a.workspaceId === workspaceId);
    this.pendingCancellationLogs.add(workspaceId);

    const result = await new Promise<boolean>((resolve, reject) => {
      console.log('[CodexService] stopMessageStream: attempting to stop process', workspaceId);
      const cleanup = () => {
        process.removeListener('close', handleClose);
        process.removeListener('error', handleError);
      };

      const handleClose = () => {
        console.log('[CodexService] stopMessageStream: process closed', workspaceId);
        this.appendStreamLog(workspaceId, '\n[CANCELLED] Codex stream stopped by user\n');
        this.pendingCancellationLogs.delete(workspaceId);
        this.finalizeStreamLog(workspaceId);
        cleanup();
        resolve(true);
      };

      const handleError = (error: Error) => {
        console.error('[CodexService] stopMessageStream: process error', workspaceId, error);
        this.pendingCancellationLogs.delete(workspaceId);
        cleanup();
        reject(error);
      };

      process.once('close', handleClose);
      process.once('error', handleError);

      try {
        const killed = process.kill('SIGINT');
        if (!killed) {
          console.warn(
            '[CodexService] stopMessageStream: SIGINT not delivered, sending SIGTERM',
            workspaceId
          );
          process.kill('SIGTERM');
        }
      } catch (err: any) {
        if (err && typeof err === 'object' && err.code === 'ESRCH') {
          console.warn('[CodexService] stopMessageStream: process already exited', workspaceId);
          cleanup();
          resolve(true);
          return;
        }
        console.error('[CodexService] stopMessageStream: error sending signal', workspaceId, err);
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
    }).catch((error) => {
      console.error('Failed to stop Codex stream:', error);
      return false;
    });

    this.runningProcesses.delete(workspaceId);
    if (agent) {
      agent.status = 'idle';
    }

    // Clear any active conversation association for this workspace
    this.activeConversations.delete(workspaceId);
    return result;
  }

  /**
   * Send a message to a Codex agent (non-streaming)
   */
  public async sendMessage(workspaceId: string, message: string): Promise<CodexResponse> {
    // Find agent for this workspace
    const agent = Array.from(this.agents.values()).find((a) => a.workspaceId === workspaceId);

    if (!agent) {
      return {
        success: false,
        error: 'No agent found for this workspace',
        agentId: '',
      };
    }

    if (!this.isCodexInstalled) {
      return {
        success: false,
        error: 'Codex CLI is not installed. Please install it with: npm install -g @openai/codex',
        agentId: agent.id,
      };
    }

    // Update agent status
    agent.status = 'running';
    agent.lastMessage = message;

    try {
      const args = this.buildCodexExecArgs(message);
      log.info(
        `Executing: codex ${args.map((a) => (a.includes(' ') ? '"' + a + '"' : a)).join(' ')} in ${agent.worktreePath}`
      );

      const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>(
        (resolve, reject) => {
          execFile(
            'codex',
            args,
            { cwd: agent.worktreePath, timeout: 60000 },
            (error, stdout, stderr) => {
              if (error) {
                (error as any).stderr = stderr;
                (error as any).stdout = stdout;
                reject(error);
              } else {
                resolve({ stdout, stderr });
              }
            }
          );
        }
      );

      agent.status = 'idle';
      agent.lastResponse = stdout;

      log.info(`Codex completed in ${agent.worktreePath}`);
      log.debug('Codex stdout:', stdout);
      log.debug('Codex stderr:', stderr);

      return {
        success: true,
        output: stdout,
        agentId: agent.id,
      };
    } catch (error: any) {
      agent.status = 'error';

      let errorMessage = 'Unknown error occurred';
      if (error.code === 'ENOENT') {
        errorMessage = 'Codex CLI not found. Please install it with: npm install -g @openai/codex';
      } else if (error.code === 'TIMEOUT') {
        errorMessage = 'Codex command timed out';
      } else if (error.stderr) {
        errorMessage = error.stderr;
      } else if (error.message) {
        errorMessage = error.message;
      }

      log.error(`Error executing Codex in ${agent.worktreePath}:`, errorMessage);

      return {
        success: false,
        error: errorMessage,
        agentId: agent.id,
      };
    }
  }

  /**
   * Get agent status
   */
  public getAgentStatus(workspaceId: string): CodexAgent | null {
    return Array.from(this.agents.values()).find((a) => a.workspaceId === workspaceId) || null;
  }

  /**
   * Get all agents
   */
  public getAllAgents(): CodexAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Remove an agent
   */
  public removeAgent(workspaceId: string): boolean {
    const agent = Array.from(this.agents.values()).find((a) => a.workspaceId === workspaceId);
    if (agent) {
      this.agents.delete(agent.id);
      log.info(`Removed agent ${agent.id} for workspace ${workspaceId}`);
      return true;
    }
    return false;
  }

  /**
   * Get installation instructions
   */
  public getInstallationInstructions(): string {
    return `To install Codex CLI, run one of these commands:

npm install -g @openai/codex

or

brew install codex

After installation, authenticate with:
codex

Then try again!`;
  }
}

// Singleton instance
export const codexService = new CodexService();
