import { getProvider, type AgentProviderId } from '@shared/agent-provider-registry';
import type { ProviderCustomConfig } from '@shared/app-settings';

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

function parseArgField(value: string | undefined): string[] {
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

export function buildAgentCommand({
  providerId,
  providerConfig,
  autoApprove,
  initialPrompt,
  sessionId,
  isResuming,
}: {
  providerId: AgentProviderId;
  providerConfig: ProviderCustomConfig | undefined;
  autoApprove?: boolean;
  initialPrompt?: string;
  sessionId: string;
  isResuming?: boolean;
}): AgentCommand {
  const providerDef = getProvider(providerId);
  const [command, ...args] = parseCliPrefix(providerConfig?.cli, providerId);

  if (isResuming && providerConfig?.resumeFlag) {
    args.push(...parseArgField(providerConfig.resumeFlag));
    if (providerConfig.sessionIdFlag) {
      args.push(sessionId);
    }
  } else if (providerConfig?.sessionIdFlag) {
    args.push(...parseArgField(providerConfig.sessionIdFlag), sessionId);
  }

  if (autoApprove && providerConfig?.autoApproveFlag) {
    args.push(...parseArgField(providerConfig.autoApproveFlag));
  }

  if (!isResuming && initialPrompt && !providerDef?.useKeystrokeInjection) {
    args.push(...parseArgField(providerConfig?.initialPromptFlag), initialPrompt);
  }

  args.push(...(providerConfig?.defaultArgs ?? []));
  args.push(...parseArgField(providerConfig?.extraArgs));

  return { command, args };
}
