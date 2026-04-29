import path from 'node:path';
import { getProvider, type AgentProviderId } from '@shared/agent-provider-registry';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';
import type { ExecFn } from '@main/core/utils/exec';
import { quoteShellArg } from '@main/utils/shellEscape';

export function splitShellWords(input: string | undefined): string[] {
  const trimmed = input?.trim();
  if (!trimmed) return [];

  const words: string[] = [];
  let current = '';
  let quote: 'single' | 'double' | null = null;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (char === "'" && quote !== 'double') {
      quote = quote === 'single' ? null : 'single';
      continue;
    }

    if (char === '"' && quote !== 'single') {
      quote = quote === 'double' ? null : 'double';
      continue;
    }

    if (char === '\\' && quote !== 'single') {
      const next = trimmed[i + 1];
      if (!next) {
        current += char;
      } else if (
        !quote ||
        next === '\\' ||
        next === '"' ||
        next === '$' ||
        next === '`' ||
        next === '\n'
      ) {
        current += next;
        i++;
      } else {
        current += char;
      }
      continue;
    }

    if (/\s/.test(char) && !quote) {
      if (current) {
        words.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) words.push(current);
  return words;
}

const compilerResolutionCache = new Map<string, Promise<string>>();

async function maybeAvoidSystemCCompiler({
  providerId,
  cli,
  fallbackCli,
  exec,
}: {
  providerId: AgentProviderId;
  cli: string;
  fallbackCli?: string;
  exec?: ExecFn;
}): Promise<string> {
  if (providerId !== 'claude' || !fallbackCli || cli === fallbackCli || !exec) return cli;

  // Login-shell `command -v` is slow on macOS (sources zprofile/nvm/etc).
  // The result is static for a given (providerId, cli, fallbackCli) within a process.
  const key = `${providerId}|${cli}|${fallbackCli}`;
  const cached = compilerResolutionCache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    try {
      const result = await exec('bash', ['-lc', `command -v -- ${quoteShellArg(cli)}`], {
        timeout: 2000,
        maxBuffer: 2048,
      });
      const resolved = result.stdout.trim().split(/\r?\n/)[0];
      const basename = path.basename(resolved);
      if (basename === 'cc' || basename === 'clang' || basename === 'gcc') return fallbackCli;
    } catch {
      // If resolution fails, keep the user's custom command and let the shell report the real error.
    }
    return cli;
  })();

  compilerResolutionCache.set(key, pending);
  return pending;
}

export async function buildAgentCommand({
  providerId,
  autoApprove,
  initialPrompt,
  sessionId,
  isResuming,
  exec,
}: {
  providerId: AgentProviderId;
  autoApprove?: boolean;
  initialPrompt?: string;
  sessionId: string;
  isResuming?: boolean;
  exec?: ExecFn;
}) {
  const providerConfig = await providerOverrideSettings.getItem(providerId);
  const providerDef = getProvider(providerId);

  const cliTokens = splitShellWords(providerConfig?.cli);
  const configuredCli = cliTokens[0] ?? providerDef?.cli;
  const cliArgs = cliTokens.slice(1);
  if (!configuredCli) throw new Error(`No CLI configured for provider: ${providerId}`);

  const cli = await maybeAvoidSystemCCompiler({
    providerId,
    cli: configuredCli,
    fallbackCli: providerDef?.cli,
    exec,
  });
  const args: string[] = [...cliArgs, ...(providerConfig?.defaultArgs ?? [])];

  if (isResuming && providerConfig?.resumeFlag) {
    args.push(...splitShellWords(providerConfig.resumeFlag));
    if (providerConfig?.sessionIdFlag) {
      args.push(sessionId);
    }
  } else if (providerConfig?.sessionIdFlag) {
    args.push(providerConfig.sessionIdFlag, sessionId);
  }

  if (
    autoApprove &&
    providerConfig?.autoApproveFlag &&
    !args.includes(providerConfig.autoApproveFlag)
  ) {
    // Best-effort dedupe: equivalent aliases/flag values are provider-specific.
    args.push(providerConfig.autoApproveFlag);
  }

  args.push(...splitShellWords(providerConfig?.extraArgs));

  if (!isResuming && initialPrompt && !providerDef?.useKeystrokeInjection) {
    const flag = providerConfig?.initialPromptFlag;
    if (flag) {
      args.push(flag, initialPrompt);
    } else {
      args.push(initialPrompt);
    }
  }

  return { command: cli, args };
}
