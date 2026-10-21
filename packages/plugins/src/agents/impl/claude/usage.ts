import {
  query,
  type AccountInfo,
  type SDKControlGetUsageResponse,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { UsageProbeResult, UsageWindow } from '@emdash/core/primitives/provider-usage/api';
import type { UsageProbeContext } from '@emdash/core/services/agent-plugins/api/plugins';
import { runWithTimeout } from '@emdash/shared/scheduling';
import { percent, resetTime } from '../../helpers/usage-probe';

function planLabel(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const key = value
    .toLowerCase()
    .replace(/[\s_-]/g, '')
    .replace(/^claude/, '')
    .replace(/subscription$|plan$/, '');
  const known: Record<string, string> = {
    free: 'Free',
    pro: 'Pro',
    max: 'Max',
    max5: 'Max 5x',
    max5x: 'Max 5x',
    max20: 'Max 20x',
    max20x: 'Max 20x',
    team: 'Team',
    teams: 'Team',
    enterprise: 'Enterprise',
  };
  return known[key] ?? value;
}

export function claudeUsageWindows(
  usage: Pick<SDKControlGetUsageResponse, 'rate_limits_available' | 'rate_limits'>
): UsageWindow[] {
  if (!usage.rate_limits_available || !usage.rate_limits) return [];
  const limits = usage.rate_limits;
  const windows: UsageWindow[] = [];
  for (const [id, label, durationMinutes] of [
    ['five_hour', '5-hour', 300],
    ['seven_day', 'Weekly', 10080],
    ['seven_day_oauth_apps', 'Weekly · OAuth apps', 10080],
  ] as const) {
    const value = limits[id];
    if (value)
      windows.push({
        id,
        label,
        durationMinutes,
        usedPercent: percent(value.utilization),
        resetsAt: resetTime(value.resets_at),
      });
  }
  const models = limits.model_scoped ?? [
    ...(limits.seven_day_opus ? [{ display_name: 'Opus', ...limits.seven_day_opus }] : []),
    ...(limits.seven_day_sonnet ? [{ display_name: 'Sonnet', ...limits.seven_day_sonnet }] : []),
  ];
  for (const value of models)
    windows.push({
      id: `model:${value.display_name.toLowerCase()}`,
      label: `Weekly · ${value.display_name}`,
      durationMinutes: 10080,
      usedPercent: percent(value.utilization),
      resetsAt: resetTime(value.resets_at),
    });
  return windows;
}

export async function probeClaudeUsage(ctx: UsageProbeContext): Promise<UsageProbeResult> {
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  ctx.signal.throwIfAborted();
  ctx.signal.addEventListener('abort', abort, { once: true });
  let q: ReturnType<typeof query> | undefined;
  try {
    q = query({
      // Deliberately never yield a message: initialization/control requests only.
      // oxlint-disable-next-line require-yield
      prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
        await new Promise<void>((resolve) => {
          if (abortController.signal.aborted) resolve();
          else abortController.signal.addEventListener('abort', () => resolve(), { once: true });
        });
      })(),
      options: {
        pathToClaudeCodeExecutable: ctx.cli,
        cwd: ctx.cwd,
        abortController,
        persistSession: false,
        settingSources: ['user'],
        settings: { disableAllHooks: true },
        allowedTools: [],
        mcpServers: {},
        strictMcpConfig: true,
        env: {
          ...ctx.env,
          ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
          FORCE_CODE_TERMINAL: undefined,
          CLAUDE_CODE_AUTO_CONNECT_IDE: '0',
          CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: '1',
        },
        stderr: () => {},
      },
    });
    const session = q;
    const init = await runWithTimeout(() => session.initializationResult(), {
      timeoutMs: 25_000,
      signal: ctx.signal,
    });
    const info: AccountInfo = init.account ?? {};
    const account = {
      email: info.email,
      organization: info.organization,
      plan: planLabel(info.subscriptionType),
    };
    if (
      (info.apiProvider && info.apiProvider !== 'firstParty') ||
      (!info.subscriptionType && info.apiKeySource)
    ) {
      return {
        status: 'unsupported',
        account,
        windows: [],
        message: 'Subscription limits are unavailable for this authentication method.',
      };
    }
    if (!info.email && !info.subscriptionType && !info.tokenSource)
      return {
        status: 'signed-out',
        windows: [],
        message: 'Sign in with Claude Code on this machine.',
      };
    try {
      const usage = await runWithTimeout(
        () =>
          session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
            skipBehaviors: true,
          }),
        { timeoutMs: 5_000, signal: ctx.signal }
      );
      const windows = claudeUsageWindows(usage);
      return {
        status: windows.length ? 'ready' : 'unsupported',
        account: { ...account, plan: planLabel(usage.subscription_type) ?? account.plan },
        windows,
        ...(windows.length ? {} : { message: 'Claude Code did not report subscription limits.' }),
      };
    } catch {
      return {
        status: 'unavailable',
        account,
        windows: [],
        message: 'Could not read limits. Check the Claude Code sign-in and CLI version.',
      };
    }
  } finally {
    ctx.signal.removeEventListener('abort', abort);
    abort();
    q?.close();
  }
}
