import { EventEmitter } from 'events';
import { ChildProcess, spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { app } from 'electron';
import path from 'path';
import { existsSync, mkdirSync, createWriteStream, WriteStream } from 'fs';
import { codexService } from './CodexService';

const execFileAsync = promisify(execFile);

export type ProviderId = 'codex' | 'claude';

export interface AgentStartOptions {
  providerId: ProviderId;
  workspaceId: string;
  worktreePath: string;
  message: string;
  conversationId?: string;
  customCommands?: string;
}

export class AgentService extends EventEmitter {
  private processes = new Map<string, ChildProcess>(); // key: providerId:workspaceId
  private writers = new Map<string, WriteStream>();

  private key(providerId: ProviderId, workspaceId: string) {
    return `${providerId}:${workspaceId}`;
  }

  private ensureLog(providerId: ProviderId, workspaceId: string) {
    const base = app.getPath('userData');
    const dir = path.join(base, 'logs', 'agent', providerId, workspaceId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'stream.log');
    const w = createWriteStream(file, { flags: 'w', encoding: 'utf8' });
    this.writers.set(this.key(providerId, workspaceId), w);
    return w;
  }

  private append(providerId: ProviderId, workspaceId: string, data: string) {
    const w = this.writers.get(this.key(providerId, workspaceId));
    if (w && !w.destroyed) w.write(data);
  }

  async isInstalled(providerId: ProviderId): Promise<boolean> {
    try {
      if (providerId === 'codex') {
        return await codexService.getInstallationStatus();
      }
      if (providerId === 'claude') {
        await execFileAsync('claude', ['--version']);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  getInstallationInstructions(providerId: ProviderId): string {
    if (providerId === 'codex') return codexService.getInstallationInstructions();
    if (providerId === 'claude') {
      return `Install Claude Code CLI:\n\n  npm install -g @anthropic-ai/claude-code\n\nThen authenticate once by running:\n\n  claude\n  /login\n\nAfter that, try again.`;
    }
    return '';
  }

  async startStream(opts: AgentStartOptions): Promise<void> {
    const { providerId, workspaceId, worktreePath, message, conversationId, customCommands } = opts;

    // If codex, delegate to codexService (and events are bridged in agent IPC setup)
    if (providerId === 'codex') {
      await codexService.sendMessageStream(workspaceId, message, conversationId, customCommands);
      return;
    }

    // Ensure only one process per workspace across providers
    for (const [key, proc] of this.processes) {
      const [, wid] = key.split(':');
      if (wid === workspaceId) {
        try {
          proc.kill('SIGTERM');
        } catch {}
        this.processes.delete(key);
      }
    }

    // Only one process per provider/workspace (redundant after global sweep but retained for safety)
    const k = this.key(providerId, workspaceId);
    const prev = this.processes.get(k);
    if (prev) {
      try {
        prev.kill('SIGTERM');
      } catch {}
      this.processes.delete(k);
    }

    const writer = this.ensureLog(providerId, workspaceId);
    writer.write(
      `=== Agent Stream ${new Date().toISOString()} ===\nProvider: ${providerId}\nWorkspace: ${workspaceId}\nMessage: ${message}\n\n--- Output ---\n`
    );

    if (providerId === 'claude') {
      // Try SDK first (preferred), fallback to CLI with safe edit flags
      let usedSdk = false;
      try {
        // Try to load SDK dynamically; avoid static import so build doesn't require it
        let cc: any = null;
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          cc = require('@anthropic/claude-code-sdk');
        } catch {}
        if (cc && typeof cc.query === 'function') {
          usedSdk = true;
          const abortController = new AbortController();
          // Store abort handle so stopStream can cancel
          const abortHandle = { kill: () => abortController.abort() } as unknown as ChildProcess;
          this.processes.set(k, abortHandle);
          (async () => {
            try {
              // Check if bypass permissions is enabled
              const bypassPermissions = customCommands?.includes('--dangerously-skip-permissions');

              const queryOptions: any = {
                cwd: worktreePath,
                includePartialMessages: true,
                permissionMode: bypassPermissions ? 'bypassPermissions' : 'acceptEdits',
                abortController,
              };

              // Only add allowedTools if not bypassing permissions
              if (!bypassPermissions) {
                queryOptions.allowedTools = ['Edit', 'MultiEdit', 'Write', 'Read'];
              }

              const q: AsyncGenerator<any, void> = cc.query({
                prompt: message,
                options: queryOptions,
              });
              for await (const msg of q) {
                try {
                  let out = '';
                  if (msg?.type === 'stream_event') {
                    const ev = msg.event || {};
                    out = ev?.delta?.text || ev?.text || '';
                  } else if (msg?.type === 'assistant') {
                    const content = msg.message?.content;
                    if (Array.isArray(content))
                      out = content.map((c: any) => c?.text || '').join('\n');
                    else if (typeof content === 'string') out = content;
                  } else if (msg?.type === 'result' && typeof msg?.result === 'string') {
                    out = msg.result;
                  }
                  if (out) {
                    this.append(providerId, workspaceId, out);
                    this.emit('agent:output', { providerId, workspaceId, output: out });
                  }
                } catch {}
              }
              this.append(providerId, workspaceId, `\n[COMPLETE] sdk success\n`);
              try {
                writer.end();
              } catch {}
              this.writers.delete(k);
              this.processes.delete(k);
              this.emit('agent:complete', { providerId, workspaceId, exitCode: 0 });
            } catch (err: any) {
              const em = err?.message || String(err);
              this.append(providerId, workspaceId, `\n[ERROR] ${em}\n`);
              this.emit('agent:error', { providerId, workspaceId, error: em });
              try {
                writer.end();
              } catch {}
              this.writers.delete(k);
              this.processes.delete(k);
            }
          })();
        }
      } catch {
        usedSdk = false;
      }

      if (!usedSdk) {
        // CLI fallback with streaming JSON
        const bypassPermissions = customCommands?.includes('--dangerously-skip-permissions');

        const args = ['-p', message, '--verbose', '--output-format', 'stream-json'];

        // When bypassing permissions, don't add any permission or allowedTools flags
        if (bypassPermissions) {
          args.push('--dangerously-skip-permissions');
        } else {
          // Only set permission-mode and allowedTools if not bypassing
          args.push('--permission-mode', 'acceptEdits');
          args.push(
            '--allowedTools',
            'Edit',
            '--allowedTools',
            'MultiEdit',
            '--allowedTools',
            'Write',
            '--allowedTools',
            'Read'
          );
        }
        const child = spawn('claude', args, {
          cwd: worktreePath,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        this.processes.set(k, child);
        let partial = '';
        child.stdout.on('data', (buf) => {
          partial += buf.toString();
          // Process line-delimited JSON events
          let idx;
          while ((idx = partial.indexOf('\n')) >= 0) {
            const line = partial.slice(0, idx).trim();
            partial = partial.slice(idx + 1);
            if (!line) continue;
            try {
              const obj = JSON.parse(line);
              let out = '';
              if (obj?.type === 'stream_event') {
                const ev = obj?.event || {};
                out = ev?.delta?.text || ev?.text || '';
              } else if (obj?.type === 'assistant') {
                const content = obj?.message?.content;
                if (Array.isArray(content)) out = content.map((c: any) => c?.text || '').join('\n');
                else if (typeof content === 'string') out = content;
              } else if (obj?.type === 'result' && typeof obj?.result === 'string') {
                out = obj.result;
              } else if (typeof obj?.message === 'string') {
                out = obj.message;
              }
              if (out) {
                this.append(providerId, workspaceId, out);
                this.emit('agent:output', { providerId, workspaceId, output: out });
              }
            } catch {
              // If not JSON, treat as plain text chunk
              this.append(providerId, workspaceId, line + '\n');
              this.emit('agent:output', { providerId, workspaceId, output: line + '\n' });
            }
          }
        });
        child.stderr.on('data', (buf) => {
          const s = buf.toString();
          this.append(providerId, workspaceId, `\n[stderr] ${s}`);
          this.emit('agent:error', { providerId, workspaceId, error: s });
        });
        child.on('close', (code) => {
          this.append(providerId, workspaceId, `\n[COMPLETE] exit code ${code}\n`);
          try {
            writer.end();
          } catch {}
          this.writers.delete(k);
          this.processes.delete(k);
          this.emit('agent:complete', { providerId, workspaceId, exitCode: code ?? 0 });
        });
        child.on('error', (err) => {
          this.emit('agent:error', { providerId, workspaceId, error: err.message });
        });
      }
      return;
    }

    // No other providers handled here
  }

  async stopStream(providerId: ProviderId, workspaceId: string): Promise<boolean> {
    if (providerId === 'codex') {
      return await codexService.stopMessageStream(workspaceId);
    }
    const k = this.key(providerId, workspaceId);
    const p = this.processes.get(k);
    if (!p) return true;
    try {
      p.kill('SIGTERM');
      this.processes.delete(k);
      const w = this.writers.get(k);
      if (w && !w.destroyed) w.end();
      this.writers.delete(k);
      return true;
    } catch {
      return false;
    }
  }
}

export const agentService = new AgentService();
