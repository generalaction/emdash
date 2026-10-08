import { query } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { claudeUsageWindows, probeClaudeUsage } from './usage';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));

describe('Claude subscription limits', () => {
  it('keeps missing utilization unknown and model-scoped limits separate', () => {
    expect(
      claudeUsageWindows({
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 0.5, resets_at: '2026-10-07T12:00:00Z' },
          seven_day: { utilization: null, resets_at: null },
          model_scoped: [{ display_name: 'Fable', utilization: 92, resets_at: 'invalid' }],
        },
      })
    ).toEqual([
      {
        id: 'five_hour',
        label: '5-hour',
        durationMinutes: 300,
        usedPercent: 0.5,
        resetsAt: Date.parse('2026-10-07T12:00:00Z'),
      },
      {
        id: 'seven_day',
        label: 'Weekly',
        durationMinutes: 10080,
        usedPercent: null,
        resetsAt: null,
      },
      {
        id: 'model:fable',
        label: 'Weekly · Fable',
        durationMinutes: 10080,
        usedPercent: 92,
        resetsAt: null,
      },
    ]);
  });
  it('reads only control data with hooks/MCP disabled, then closes without yielding a prompt', async () => {
    const close = vi.fn();
    const usage = vi.fn(async () => ({
      subscription_type: 'pro',
      rate_limits_available: true,
      rate_limits: { five_hour: { utilization: 20, resets_at: null } },
    }));
    vi.mocked(query).mockReturnValue({
      initializationResult: async () => ({
        account: { email: 'one@example.com', organization: 'org-1', subscriptionType: 'pro' },
      }),
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: usage,
      close,
    } as unknown as ReturnType<typeof query>);
    const result = await probeClaudeUsage({
      cli: '/bin/claude',
      cwd: '/home/test',
      env: {},
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      status: 'ready',
      account: { email: 'one@example.com', organization: 'org-1' },
    });
    expect(usage).toHaveBeenCalledWith({ skipBehaviors: true });
    const options = vi.mocked(query).mock.calls.at(-1)?.[0];
    expect(options?.options).toMatchObject({
      persistSession: false,
      settingSources: ['user'],
      settings: { disableAllHooks: true },
      strictMcpConfig: true,
      mcpServers: {},
      allowedTools: [],
      pathToClaudeCodeExecutable: '/bin/claude',
    });
    expect(close).toHaveBeenCalledOnce();
    if (!options || typeof options.prompt === 'string')
      throw new Error('Expected a stream without prompts');
    expect(await options.prompt[Symbol.asyncIterator]().next()).toEqual({
      done: true,
      value: undefined,
    });
  });
  it('keeps identity when the optional usage API fails', async () => {
    vi.mocked(query).mockReturnValue({
      initializationResult: async () => ({
        account: { email: 'one@example.com', subscriptionType: 'max' },
      }),
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
        throw new Error('secret must never be returned');
      },
      close: vi.fn(),
    } as unknown as ReturnType<typeof query>);
    const result = await probeClaudeUsage({
      cli: 'claude',
      cwd: '/home/test',
      env: {},
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      status: 'unavailable',
      account: { email: 'one@example.com' },
      windows: [],
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});
