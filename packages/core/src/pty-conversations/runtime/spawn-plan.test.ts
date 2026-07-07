import { describe, expect, it, vi } from 'vitest';
import {
  definePlugin,
  registerPluginBehavior,
  type CLIAgentPluginProvider,
} from '../../agents/plugins';
import type { CommandContext } from '../../agents/plugins/capabilities/prompt';
import type { PtyAgentStartInput } from '../api/schemas';
import { planSpawn } from './spawn-plan';

const icon = {
  kind: 'svg' as const,
  variants: [{ minSize: 0, light: '<svg />' }],
};

type SpawnPlanTestInput = PtyAgentStartInput & {
  mode: 'fresh' | 'resume';
};

function startInput(overrides: Partial<SpawnPlanTestInput> = {}): SpawnPlanTestInput {
  return {
    conversationId: 'conversation-1',
    providerId: 'fake',
    cwd: '/repo',
    sessionId: null,
    model: 'model-1',
    resume: false,
    initialPrompt: 'hello',
    autoApprove: true,
    extraArgs: ['--extra'],
    cols: 80,
    rows: 24,
    mode: 'fresh',
    ...overrides,
  };
}

function makePlugin(args: {
  sessionsKind?: 'resumable' | 'stateless';
  requiresProviderSessionId?: boolean;
  buildCommand?: (ctx: CommandContext) => { command: string; args: string[]; env: Record<string, string> };
} = {}): CLIAgentPluginProvider {
  const plugin = definePlugin(
    {
      id: 'fake',
      name: 'Fake',
      description: 'Fake test provider',
      websiteUrl: 'https://example.invalid',
    },
    {
      hostDependency: {
        id: 'fake',
        binaryNames: ['fake-cli'],
        installCommands: { macos: [], linux: [], windows: [] },
        updates: { kind: 'none' },
      },
      prompt: { kind: 'argv', flag: '' },
      sessions: {
        kind: args.sessionsKind ?? 'resumable',
        ...(args.requiresProviderSessionId ? { requiresProviderSessionId: true } : {}),
      },
    },
    { icon }
  );

  return registerPluginBehavior(plugin, {
    prompt: {
      buildCommand:
        args.buildCommand ??
        ((ctx) => ({
          command: ctx.cli,
          args: [ctx.isResuming ? 'resume' : 'fresh', ctx.sessionId ?? ''],
          env: { AGENT_ENV: '1' },
        })),
    },
  });
}

describe('planSpawn', () => {
  it('builds a spawn plan and passes through shell setup and tmux fields', () => {
    const result = planSpawn(
      startInput({ shellSetup: 'source ~/.profile', tmuxSessionName: 'task-1' }),
      makePlugin(),
      '/usr/bin/fake'
    );

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        resolvedSessionId: 'conversation-1',
        spec: expect.objectContaining({
          command: '/usr/bin/fake',
          shellSetup: 'source ~/.profile',
          tmuxSessionName: 'task-1',
        }),
      }),
    });
  });

  it('uses descriptor-driven provider session id requirements for resume', () => {
    const buildCommand = vi.fn((ctx: CommandContext) => ({
      command: ctx.cli,
      args: [ctx.isResuming ? 'resume' : 'fresh'],
      env: {},
    }));
    const plugin = makePlugin({ requiresProviderSessionId: true, buildCommand });

    const fallback = planSpawn(startInput({ resume: true, mode: 'resume' }), plugin, 'fake');
    expect(fallback.success && fallback.data.commandSession.isResuming).toBe(false);
    expect(buildCommand).toHaveBeenLastCalledWith(expect.objectContaining({ isResuming: false }));

    const native = planSpawn(
      startInput({ resume: true, mode: 'resume', sessionId: 'provider-session-1' }),
      plugin,
      'fake'
    );
    expect(native.success && native.data.resolvedSessionId).toBe('provider-session-1');
    expect(buildCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isResuming: true,
        sessionId: 'provider-session-1',
        providerSessionId: 'provider-session-1',
      })
    );
  });

  it('returns typed errors for unsupported resume and missing prompt behavior', () => {
    expect(planSpawn(startInput({ resume: true, mode: 'resume' }), makePlugin({ sessionsKind: 'stateless' }), 'fake')).toEqual({
      success: false,
      error: { type: 'resume-unsupported', providerId: 'fake' },
    });

    const noPrompt = {
      ...makePlugin(),
      behavior: {},
    } as unknown as CLIAgentPluginProvider;
    expect(planSpawn(startInput(), noPrompt, 'fake')).toEqual({
      success: false,
      error: { type: 'no-command', providerId: 'fake' },
    });
  });
});
