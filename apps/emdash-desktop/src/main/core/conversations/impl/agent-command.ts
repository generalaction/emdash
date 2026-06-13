import { quoteShellArg } from '@main/utils/shellEscape';
import { buildAgentModelArgs, type AgentModelSelection } from '@shared/core/agents/agent-models';
import {
  getProvider,
  isValidProviderSessionId,
  type AgentProviderId,
} from '@shared/core/agents/agent-provider-registry';
import type { ProviderCustomConfig } from '@shared/core/app-settings';
import { addKimiHooksToConfigText } from '../../agent-hooks/hook-config';

export type AgentCommand = {
  command: string;
  args: string[];
};

const SHELL_SYNTAX_ERROR = 'Custom CLI commands support executable command prefixes only. ';

const SHELL_BUILTINS = new Set(['.', 'source', 'eval', 'exec', 'cd', 'alias', 'export']);

type ParsedWords = { ok: true; words: string[] } | { ok: false; reason: string };

export function parseShellWords(
  input: string,
  options: { rejectShellSyntax?: boolean } = {}
): ParsedWords {
  const words: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (options.rejectShellSyntax && !inSingleQuote && !inDoubleQuote) {
      if (char === '$' || char === '`' || /[|&;<>]/.test(char)) {
        return { ok: false, reason: SHELL_SYNTAX_ERROR };
      }
    }

    if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        words.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaped) current += '\\';
  if (inSingleQuote || inDoubleQuote) return { ok: false, reason: 'Unclosed quote.' };
  if (current.length > 0) words.push(current);

  return { ok: true, words };
}

export function parseArgField(value: string | undefined): string[] {
  if (!value) return [];
  const parsed = parseShellWords(value);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.words;
}

function parseCliPrefix(value: string | undefined, providerId: AgentProviderId): string[] {
  const cli = value?.trim();
  if (!cli) throw new Error(`Missing CLI command for provider: ${providerId}`);

  const parsed = parseShellWords(cli, { rejectShellSyntax: true });
  if (!parsed.ok) throw new Error(parsed.reason);
  const [command] = parsed.words;
  if (!command) throw new Error(`Missing CLI command for provider: ${providerId}`);
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(command)) throw new Error(SHELL_SYNTAX_ERROR);
  if (SHELL_BUILTINS.has(command)) throw new Error(SHELL_SYNTAX_ERROR);

  return parsed.words;
}

function appendSessionId(args: string[], flag: string, sessionId: string): void {
  const parts = parseArgField(flag);
  if (parts[parts.length - 1]?.endsWith('=')) {
    parts[parts.length - 1] += sessionId;
    args.push(...parts);
    return;
  }

  args.push(...parts, sessionId);
}

function dedupeSingletonArgs(args: string[], singletonArgs: readonly string[]): string[] {
  const singletons = new Set(singletonArgs);
  const seen = new Set<string>();
  return args.filter((arg) => {
    if (!singletons.has(arg)) return true;
    if (seen.has(arg)) return false;
    seen.add(arg);
    return true;
  });
}

function injectKimiHooksIntoInlineConfig(args: string[]): string[] {
  return args.map((arg, index) => {
    if (arg === '--config' && args[index + 1] !== undefined) {
      return arg;
    }

    if (index > 0 && args[index - 1] === '--config') {
      return addKimiHooksToConfigText(arg);
    }

    if (arg.startsWith('--config=')) {
      return `--config=${addKimiHooksToConfigText(arg.slice('--config='.length))}`;
    }

    return arg;
  });
}

export function buildAgentCommand({
  providerId,
  providerConfig,
  autoApprove,
  extraInitialArgs,
  initialPrompt,
  sessionId,
  providerSessionId,
  isResuming,
  modelSelection,
}: {
  providerId: AgentProviderId;
  providerConfig: ProviderCustomConfig | undefined;
  autoApprove?: boolean;
  extraInitialArgs?: readonly string[];
  initialPrompt?: string;
  sessionId: string;
  providerSessionId?: string;
  isResuming?: boolean;
  modelSelection?: AgentModelSelection;
}): AgentCommand {
  const providerDef = getProvider(providerId);
  const [command, ...args] = parseCliPrefix(providerConfig?.cli, providerId);
  const initialPromptFlag = providerConfig?.initialPromptFlag;

  args.push(...(providerConfig?.defaultArgs ?? []));

  const sessionIdFlag = providerConfig?.sessionIdFlag;
  const shouldPassSessionId =
    sessionIdFlag !== undefined && (!providerConfig?.sessionIdOnResumeOnly || isResuming);

  const validProviderSessionId =
    providerSessionId && isValidProviderSessionId(providerId, providerSessionId)
      ? providerSessionId
      : undefined;

  if (isResuming && providerConfig?.resumeFlag) {
    if (providerConfig.sessionIdFlag && validProviderSessionId) {
      appendSessionId(args, providerConfig.resumeFlag, validProviderSessionId);
    } else if (providerConfig.sessionIdFlag && !providerConfig.sessionIdOnResumeOnly) {
      appendSessionId(args, providerConfig.resumeFlag, sessionId);
    } else if (providerConfig.resumeWithoutSessionFlag) {
      args.push(...parseArgField(providerConfig.resumeWithoutSessionFlag));
    } else {
      args.push(...parseArgField(providerConfig.resumeFlag));
    }
  } else if (shouldPassSessionId) {
    appendSessionId(args, sessionIdFlag, sessionId);
  } else if (!isResuming && providerDef?.newConversationFlag) {
    args.push(providerDef.newConversationFlag);
  }

  const autoApproveFlag = providerConfig?.autoApproveFlag;
  const shouldAppendAutoApproveFlag =
    autoApprove &&
    autoApproveFlag &&
    // Kimi preserves approval settings on resume and rejects --yolo with --continue/--session.
    !(providerId === 'kimi' && isResuming);

  if (shouldAppendAutoApproveFlag) {
    args.push(...parseArgField(autoApproveFlag));
  }

  // Apply the configured model/reasoning flags only on a fresh start. On resume,
  // providers re-attach to an existing session (often via a subcommand such as
  // `codex resume <id>`) that already carries its model, and appending model
  // flags there can conflict with the resume argument shape.
  if (!isResuming) {
    args.push(...buildAgentModelArgs(providerId, modelSelection));
  }

  if (!isResuming && extraInitialArgs?.length) {
    args.push(...extraInitialArgs);
  } else if (
    !isResuming &&
    initialPrompt &&
    !providerDef?.useKeystrokeInjection &&
    !providerDef?.initialPromptViaStdinPipe
  ) {
    args.push(...parseArgField(initialPromptFlag), initialPrompt);
  }

  args.push(...parseArgField(providerConfig?.extraArgs));

  const finalArgs =
    providerId === 'codex'
      ? dedupeSingletonArgs(args, ['--dangerously-bypass-approvals-and-sandbox'])
      : args;

  return {
    command,
    args: providerId === 'kimi' ? injectKimiHooksIntoInlineConfig(finalArgs) : finalArgs,
  };
}

export function wrapAgentCommandWithStdinPipe(agent: AgentCommand, prompt: string): AgentCommand {
  const agentLine = [agent.command, ...agent.args].map(quoteShellArg).join(' ');
  const shellLine = `printf '%s\\n' ${quoteShellArg(prompt)} | ${agentLine}`;
  return { command: 'bash', args: ['-c', shellLine] };
}

export function buildAgentSessionCommand(args: {
  providerId: AgentProviderId;
  providerConfig: ProviderCustomConfig | undefined;
  autoApprove?: boolean;
  extraInitialArgs?: readonly string[];
  initialPrompt?: string;
  sessionId: string;
  providerSessionId?: string;
  isResuming?: boolean;
  modelSelection?: AgentModelSelection;
}): AgentCommand {
  const command = buildAgentCommand(args);
  const prompt = args.initialPrompt?.trim();
  const providerDef = getProvider(args.providerId);
  if (!args.isResuming && prompt && providerDef?.initialPromptViaStdinPipe) {
    return wrapAgentCommandWithStdinPipe(command, prompt);
  }
  return command;
}
