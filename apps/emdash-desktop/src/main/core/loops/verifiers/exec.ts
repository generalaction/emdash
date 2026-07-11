import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import {
  DEFAULT_LOOP_COMMAND_TIMEOUT_MS,
  OUTPUT_TAIL_MAX,
  runLoopCommand,
  tail,
  type LoopCommandFailure,
  type LoopCommandResult,
} from '../runtime/loop-command-runner';
import type { LoopExecutionTarget } from '../runtime/loop-execution-target';

export { OUTPUT_TAIL_MAX, tail };
export const DEFAULT_VERIFIER_TIMEOUT_MS = DEFAULT_LOOP_COMMAND_TIMEOUT_MS;

export type ParsedCommand = {
  file: string;
  args: string[];
  env: Record<string, string>;
};

export type ExecFileResult = LoopCommandResult;
export type ExecFileFailure = LoopCommandFailure;

export class CommandParseError extends Error {}

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

  const env: Record<string, string> = {};
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

export async function runExecFile(
  file: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    env?: Readonly<Record<string, string | undefined>>;
    maxBuffer?: number;
    executionTarget?: LoopExecutionTarget;
  }
): Promise<ExecFileResult> {
  if (options.executionTarget) {
    return runLoopCommand(options.executionTarget, file, args, options);
  }

  const executionContext = new LocalExecutionContext({ root: options.cwd });
  const legacyTarget: LoopExecutionTarget = {
    workspaceId: 'legacy-local-loop-command',
    path: options.cwd,
    machine: { kind: 'local' },
    executionContext,
    taskEnv: {},
    dispose: () => executionContext.dispose(),
  };
  try {
    return await runLoopCommand(legacyTarget, file, args, options);
  } finally {
    legacyTarget.dispose();
  }
}
