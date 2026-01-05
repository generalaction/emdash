import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { log } from '../lib/logger';

export interface HeadlessAgentProgress {
  type: 'tool_use' | 'text' | 'complete' | 'error';
  toolName?: string;
  text?: string;
  elapsedMs: number;
}

export interface HeadlessAgentResult {
  success: boolean;
  output: string;
  elapsedMs: number;
  error?: string;
}

interface StreamMessage {
  type: 'assistant' | 'user' | 'system' | 'result';
  subtype?: 'init';
  message?: {
    content?: Array<{
      type: 'text' | 'tool_use' | 'tool_result';
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
  status?: 'success' | 'error';
  duration_ms?: number;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export class HeadlessAgentRunner extends EventEmitter {
  private proc: ChildProcess | null = null;
  private output = '';
  private lineBuffer = ''; // Buffer for incomplete lines from stdout
  private startTime = 0;
  private worktreePath: string;
  private prompt: string;
  private timeoutMs: number;
  private timeoutId: NodeJS.Timeout | null = null;

  constructor(worktreePath: string, prompt: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
    super();
    this.worktreePath = worktreePath;
    this.prompt = prompt;
    this.timeoutMs = timeoutMs;
  }

  start(): Promise<HeadlessAgentResult> {
    return new Promise((resolve, reject) => {
      this.startTime = Date.now();

      try {
        this.proc = spawn(
          'claude',
          ['-p', this.prompt, '--output-format', 'stream-json', '--dangerously-skip-permissions'],
          {
            cwd: this.worktreePath,
            env: { ...process.env },
            shell: true,
          }
        );

        log.info('HeadlessAgentService:started', {
          worktreePath: this.worktreePath,
          pid: this.proc.pid,
        });

        // Set timeout
        this.timeoutId = setTimeout(() => {
          log.warn('HeadlessAgentService:timeout', { worktreePath: this.worktreePath });
          this.kill();
          resolve({
            success: false,
            output: this.output,
            elapsedMs: Date.now() - this.startTime,
            error: 'Agent timed out',
          });
        }, this.timeoutMs);

        this.proc.stdout?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          log.info('HeadlessAgentService:stdout', {
            worktreePath: this.worktreePath,
            length: chunk.length,
            preview: chunk.slice(0, 300),
          });
          this.output += chunk;
          this.parseStreamChunk(chunk);
        });

        this.proc.stderr?.on('data', (data: Buffer) => {
          log.warn('HeadlessAgentService:stderr', {
            worktreePath: this.worktreePath,
            data: data.toString().slice(0, 500),
          });
        });

        this.proc.on('error', (err) => {
          log.error('HeadlessAgentService:error', { error: err.message });
          this.clearTimeout();
          reject(err);
        });

        this.proc.on('exit', (code) => {
          this.clearTimeout();
          const elapsedMs = Date.now() - this.startTime;
          log.info('HeadlessAgentService:exit', {
            code,
            elapsedMs,
            worktreePath: this.worktreePath,
          });

          this.emit('progress', {
            type: 'complete',
            elapsedMs,
          } as HeadlessAgentProgress);

          resolve({
            success: code === 0,
            output: this.output,
            elapsedMs,
            error: code !== 0 ? `Process exited with code ${code}` : undefined,
          });
        });
      } catch (err: any) {
        log.error('HeadlessAgentService:spawnError', { error: err.message });
        reject(err);
      }
    });
  }

  private parseStreamChunk(chunk: string): void {
    // Append chunk to buffer
    this.lineBuffer += chunk;

    // Process complete lines (those ending with \n)
    const lines = this.lineBuffer.split('\n');

    // Keep the last element in buffer (it's either empty or an incomplete line)
    this.lineBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg: StreamMessage = JSON.parse(trimmed);
        this.handleStreamMessage(msg);
      } catch {
        // Not valid JSON, skip
      }
    }
  }

  private handleStreamMessage(msg: StreamMessage): void {
    const elapsedMs = Date.now() - this.startTime;

    if (msg.type === 'assistant' && msg.message?.content) {
      for (const content of msg.message.content) {
        if (content.type === 'tool_use' && content.name) {
          this.emit('progress', {
            type: 'tool_use',
            toolName: content.name,
            elapsedMs,
          } as HeadlessAgentProgress);
        } else if (content.type === 'text' && content.text) {
          this.emit('progress', {
            type: 'text',
            text: content.text.slice(0, 100), // Truncate for progress display
            elapsedMs,
          } as HeadlessAgentProgress);
        }
      }
    }

    if (msg.type === 'result') {
      this.emit('progress', {
        type: 'complete',
        elapsedMs,
      } as HeadlessAgentProgress);
    }
  }

  private clearTimeout(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  kill(): void {
    this.clearTimeout();
    if (this.proc && !this.proc.killed) {
      this.proc.kill('SIGTERM');
      log.info('HeadlessAgentService:killed', { worktreePath: this.worktreePath });
    }
  }
}

/**
 * Run multiple headless agents in parallel and return when all complete
 */
export async function runHeadlessAgents(
  configs: Array<{ worktreePath: string; prompt: string; id: string }>,
  onProgress?: (id: string, progress: HeadlessAgentProgress) => void
): Promise<Map<string, HeadlessAgentResult>> {
  const runners = configs.map((config) => {
    const runner = new HeadlessAgentRunner(config.worktreePath, config.prompt);

    if (onProgress) {
      runner.on('progress', (progress: HeadlessAgentProgress) => {
        onProgress(config.id, progress);
      });
    }

    return {
      id: config.id,
      runner,
      promise: runner.start(),
    };
  });

  const results = new Map<string, HeadlessAgentResult>();

  // Wait for all to complete (or fail)
  const settled = await Promise.allSettled(runners.map((r) => r.promise));

  for (let i = 0; i < runners.length; i++) {
    const { id } = runners[i];
    const result = settled[i];

    if (result.status === 'fulfilled') {
      results.set(id, result.value);
    } else {
      results.set(id, {
        success: false,
        output: '',
        elapsedMs: 0,
        error: result.reason?.message || 'Unknown error',
      });
    }
  }

  return results;
}

/**
 * Get git diff for a worktree compared to its base branch
 */
export async function getWorktreeDiff(worktreePath: string, baseBranch = 'main'): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', ['diff', `${baseBranch}...HEAD`], {
      cwd: worktreePath,
    });

    let output = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('exit', (code) => {
      if (code === 0) {
        // TODO: Handle edge case for massive diffs - log size for now
        const diffSizeKb = Math.round(output.length / 1024);
        if (diffSizeKb > 50) {
          log.warn('HeadlessAgentService:largeDiff', {
            worktreePath,
            sizeKb: diffSizeKb,
          });
        }
        resolve(output);
      } else {
        reject(new Error(`git diff failed: ${stderr}`));
      }
    });

    proc.on('error', reject);
  });
}

export interface JudgeResult {
  winner: 'A' | 'B';
  reasoning: string;
  success: boolean;
  error?: string;
}

/**
 * Run the judge to compare two solutions and pick the best one
 */
export async function runJudge(
  originalPrompt: string,
  diffA: string,
  diffB: string,
  onProgress?: (progress: HeadlessAgentProgress) => void
): Promise<JudgeResult> {
  const judgePrompt = `You are a code review judge. Compare these two solutions for the following task and pick the better one.

TASK: ${originalPrompt}

SOLUTION A:
\`\`\`diff
${diffA.slice(0, 50000)}
\`\`\`

SOLUTION B:
\`\`\`diff
${diffB.slice(0, 50000)}
\`\`\`

Analyze both solutions and reply with ONLY valid JSON in this exact format:
{"winner": "A" or "B", "reasoning": "Brief explanation of why this solution is better"}`;

  return new Promise((resolve) => {
    const startTime = Date.now();
    const proc = spawn(
      'claude',
      ['-p', judgePrompt, '--output-format', 'stream-json', '--dangerously-skip-permissions'],
      { shell: true }
    );

    let output = '';

    proc.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      output += chunk;

      // Emit progress for tool usage
      const lines = chunk.split('\n').filter((line) => line.trim());
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'assistant' && msg.message?.content) {
            for (const content of msg.message.content) {
              if (content.type === 'tool_use' && content.name) {
                onProgress?.({
                  type: 'tool_use',
                  toolName: content.name,
                  elapsedMs: Date.now() - startTime,
                });
              }
            }
          }
        } catch {
          // Not valid JSON
        }
      }
    });

    proc.on('exit', (code) => {
      const elapsedMs = Date.now() - startTime;
      onProgress?.({ type: 'complete', elapsedMs });

      if (code !== 0) {
        resolve({
          winner: 'A',
          reasoning: 'Judge failed to run, defaulting to solution A',
          success: false,
          error: `Judge exited with code ${code}`,
        });
        return;
      }

      // Parse the output to find the JSON result
      // Look for JSON in assistant messages
      try {
        const lines = output.split('\n').filter((line) => line.trim());
        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'assistant' && msg.message?.content) {
              for (const content of msg.message.content) {
                if (content.type === 'text' && content.text) {
                  // Try to extract JSON from the text
                  const jsonMatch = content.text.match(
                    /\{[\s\S]*"winner"[\s\S]*"reasoning"[\s\S]*\}/
                  );
                  if (jsonMatch) {
                    const result = JSON.parse(jsonMatch[0]);
                    if (result.winner === 'A' || result.winner === 'B') {
                      resolve({
                        winner: result.winner,
                        reasoning: result.reasoning || 'No reasoning provided',
                        success: true,
                      });
                      return;
                    }
                  }
                }
              }
            }
          } catch {
            // Continue parsing
          }
        }

        // Fallback if no valid JSON found
        log.warn('HeadlessAgentService:judgeParseError', { output: output.slice(0, 500) });
        resolve({
          winner: 'A',
          reasoning: 'Could not parse judge response, defaulting to solution A',
          success: false,
          error: 'Failed to parse judge response',
        });
      } catch (err: any) {
        resolve({
          winner: 'A',
          reasoning: 'Judge error, defaulting to solution A',
          success: false,
          error: err.message,
        });
      }
    });

    proc.on('error', (err) => {
      resolve({
        winner: 'A',
        reasoning: 'Judge failed to start',
        success: false,
        error: err.message,
      });
    });
  });
}
