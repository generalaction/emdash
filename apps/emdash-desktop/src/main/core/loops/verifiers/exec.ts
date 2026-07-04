import { execFile } from 'node:child_process';
import { buildExternalToolEnv } from '@main/utils/childProcessEnv';

export const OUTPUT_TAIL_MAX = 8_000;
export const DEFAULT_VERIFIER_TIMEOUT_MS = 120_000;

export type ParsedCommand = {
  file: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};

export type ExecFileResult = {
  file: string;
  args: string[];
  command: string;
  cwd: string;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
  exitCode: number;
};

export type ExecFileFailure = {
  file: string;
  args: string[];
  command: string;
  cwd: string;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  message: string;
};

export class CommandParseError extends Error {}

function commandDisplay(file: string, args: string[]): string {
  return [file, ...args].join(' ');
}

export function tail(value: string | Buffer | undefined | null, max = OUTPUT_TAIL_MAX): string {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : (value ?? '');
  return text.length > max ? text.slice(text.length - max) : text;
}

export function parseCommandLine(command: string): ParsedCommand {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const char of command.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\' && quote !== "'") {
      escaping = true;
      continue;
    }

    if ((char === '"' || char === "'") && quote === null) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = null;
      continue;
    }

    if (/\s/.test(char) && quote === null) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaping) current += '\\';
  if (quote !== null) throw new CommandParseError('Unterminated quote in command');
  if (current) tokens.push(current);
  if (tokens.length === 0) throw new CommandParseError('Command is empty');

  const env = buildExternalToolEnv();
  let commandIndex = 0;
  for (; commandIndex < tokens.length; commandIndex += 1) {
    const token = tokens[commandIndex]!;
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) break;
    const equalsIndex = token.indexOf('=');
    env[token.slice(0, equalsIndex)] = token.slice(equalsIndex + 1);
  }

  const file = tokens[commandIndex];
  if (!file) throw new CommandParseError('Command is empty after environment assignments');

  return {
    file,
    args: tokens.slice(commandIndex + 1),
    env,
  };
}

export function runExecFile(
  file: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    env?: NodeJS.ProcessEnv;
    maxBuffer?: number;
  }
): Promise<ExecFileResult> {
  const startedAt = Date.now();
  const command = commandDisplay(file, args);

  return new Promise((resolve, reject: (error: ExecFileFailure) => void) => {
    execFile(
      file,
      args,
      {
        cwd: options.cwd,
        env: options.env ?? buildExternalToolEnv(),
        timeout: options.timeoutMs ?? DEFAULT_VERIFIER_TIMEOUT_MS,
        maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
        signal: options.signal,
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startedAt;
        if (error) {
          const nodeError = error as NodeJS.ErrnoException & {
            code?: number | string;
            killed?: boolean;
            signal?: NodeJS.Signals;
          };
          reject({
            file,
            args,
            command,
            cwd: options.cwd,
            durationMs,
            stdoutTail: tail(stdout),
            stderrTail: tail(stderr),
            exitCode: typeof nodeError.code === 'number' ? nodeError.code : null,
            timedOut: nodeError.killed === true && nodeError.signal === 'SIGTERM',
            aborted: nodeError.name === 'AbortError',
            message: nodeError.message,
          });
          return;
        }

        resolve({
          file,
          args,
          command,
          cwd: options.cwd,
          durationMs,
          stdoutTail: tail(stdout),
          stderrTail: tail(stderr),
          exitCode: 0,
        });
      }
    );
  });
}
