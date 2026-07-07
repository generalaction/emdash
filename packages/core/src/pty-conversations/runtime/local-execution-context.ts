import { execFile, spawn } from 'node:child_process';
import type { IExecutionContext } from '../../exec/execution-context';

export class LocalProcessExecutionContext implements IExecutionContext {
  readonly supportsLocalSpawn = true;

  constructor(readonly root?: string) {}

  exec(
    command: string,
    args: string[] = [],
    opts: { timeout?: number; maxBuffer?: number; signal?: AbortSignal } = {}
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      execFile(
        command,
        args,
        {
          cwd: this.root,
          encoding: 'utf8',
          maxBuffer: opts.maxBuffer,
          signal: opts.signal,
          timeout: opts.timeout,
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ stdout, stderr });
        }
      );
    });
  }

  execStreaming(
    command: string,
    args: string[],
    onChunk: (chunk: string) => boolean,
    opts: { signal?: AbortSignal } = {}
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: this.root,
        signal: opts.signal,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (!onChunk(chunk)) child.kill();
      });
      child.once('error', reject);
      child.once('close', (code) => {
        if (code && code !== 0) {
          reject(new Error(`${command} exited with code ${code}`));
          return;
        }
        resolve();
      });
    });
  }

  dispose(): void {}
}
