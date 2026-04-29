import path from 'node:path';
import { type AgentProviderId, getProvider } from '@shared/agent-provider-registry';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';
import type { ExecFn } from '@main/core/utils/exec';
import { quoteShellArg } from '@main/utils/shellEscape';

export function splitShellWords(input: string | undefined): string[] {
  if (!input?.trim()) return [];

  const words: string[] = [];
  let current = '';
  let quote: 'single' | 'double' | null = null;

  for (let i = 0; i < input.trim().length; i++) {
    const char = input.trim()[i];

    if (char === "'" && quote !== 'double') {
      quote = quote === 'single' ? null : 'single';
      continue;
    }

    if (char === '"' && quote !== 'single') {
      quote = quote === 'double' ? null : 'double';
      continue;
    }

    if (char === '\\' && quote !== 'single') {
      const next = input.trim()[i + 1];
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

  const [configuredCli = providerDef?.cli, ...cliArgs] = splitShellWords(providerConfig?.cli);
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
