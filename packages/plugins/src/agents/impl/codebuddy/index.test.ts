import type { CommandContext, PluginFs } from '@emdash/core/agents/plugins';
import { buildNestedEntry, makeStdinHookCommand } from '@emdash/core/agents/plugins/helpers';
import { describe, expect, it } from 'vitest';
import { CODEBUDDY_SETTINGS_PATH } from './hooks';
import { provider } from './index';

const baseContext: CommandContext = {
  cli: 'codebuddy',
  autoApprove: false,
  initialPrompt: undefined,
  sessionId: '550e8400-e29b-41d4-a716-446655440000',
  providerSessionId: undefined,
  isResuming: false,
  model: '',
};

function build(context: Partial<CommandContext> = {}) {
  return provider.behavior.prompt!.buildCommand({ ...baseContext, ...context });
}

function createMemoryFs(files = new Map<string, string>()): PluginFs {
  return {
    read: async (path) => files.get(path) ?? null,
    write: async (path, content) => {
      files.set(path, content);
    },
    delete: async (path) => {
      files.delete(path);
    },
    exists: async (path) => files.has(path),
    list: async () => [],
  };
}

describe('codebuddy provider', () => {
  it('registers the documented npm package, binary aliases, and capabilities', () => {
    expect(provider.capabilities.hostDependency.binaryNames).toEqual(['codebuddy', 'cbc']);
    expect(provider.capabilities.hostDependency.installCommands.macos?.[0]?.command).toBe(
      'npm install -g @tencent-ai/codebuddy-code'
    );
    expect(provider.capabilities.hostDependency.updates).toMatchObject({
      kind: 'supported',
      releaseSource: { kind: 'npm', package: '@tencent-ai/codebuddy-code' },
    });
    expect(provider.capabilities.acp.kind).toBe('supported');
    expect(provider.capabilities.autoApprove.kind).toBe('supported');
    expect(provider.capabilities.hooks).toEqual({
      kind: 'config',
      scope: 'workspace',
      supportedEvents: ['notification', 'stop', 'session', 'start', 'tool-use-failure'],
    });
    expect(provider.capabilities.mcp).toEqual({
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
    });
    expect(provider.capabilities.sessions.kind).toBe('resumable');
  });

  it('starts the documented stdio ACP transport', () => {
    expect(
      provider.behavior.acp!.buildSpawn({
        cli: 'codebuddy',
        cwd: '/tmp/project',
        env: {},
      })
    ).toEqual({
      command: 'codebuddy',
      args: ['--acp'],
    });
  });

  it('starts a deterministic session with an initial prompt, model, and auto-approval', () => {
    expect(
      build({
        autoApprove: true,
        initialPrompt: 'Fix the bug',
        model: 'gpt-5.5',
      })
    ).toEqual({
      command: 'codebuddy',
      args: [
        '--session-id',
        '550e8400-e29b-41d4-a716-446655440000',
        '--dangerously-skip-permissions',
        '--model',
        'gpt-5.5',
        'Fix the bug',
      ],
      env: {},
    });
  });

  it('resumes the deterministic session without replaying its initial prompt', () => {
    expect(
      build({
        cli: 'cbc',
        autoApprove: true,
        initialPrompt: 'Do not replay this prompt',
        isResuming: true,
      })
    ).toEqual({
      command: 'cbc',
      args: ['--resume', '550e8400-e29b-41d4-a716-446655440000', '--dangerously-skip-permissions'],
      env: {},
    });
  });

  it('writes stdio and HTTP MCP servers using CodeBuddy native transport fields', async () => {
    const files = new Map<string, string>();
    const fs = createMemoryFs(files);

    await provider.behavior.mcp!.writeServers(fs, [
      {
        name: 'local-tools',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
      },
      {
        name: 'docs',
        transport: 'http',
        type: 'http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer token' },
      },
    ]);

    expect(JSON.parse(files.get('.codebuddy/.mcp.json')!)).toEqual({
      mcpServers: {
        'local-tools': { type: 'stdio', command: 'node', args: ['server.js'] },
        docs: {
          type: 'http',
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer token' },
        },
      },
    });
  });

  it('installs lifecycle hooks in CodeBuddy project-local settings', async () => {
    const files = new Map<string, string>([
      [
        CODEBUDDY_SETTINGS_PATH,
        JSON.stringify({
          language: 'English',
          hooks: {
            Notification: [{ hooks: [{ type: 'command', command: 'notify-user' }] }],
          },
        }),
      ],
    ]);
    const fs = createMemoryFs(files);

    await provider.behavior.hooks!.writeHooks(fs, []);
    await provider.behavior.hooks!.writeHooks(fs, []);

    const settings = JSON.parse(files.get(CODEBUDDY_SETTINGS_PATH)!);
    expect(settings.language).toBe('English');
    expect(settings.hooks.SessionStart).toEqual([
      buildNestedEntry(makeStdinHookCommand('session')),
    ]);
    expect(settings.hooks.UserPromptSubmit).toEqual([
      buildNestedEntry(makeStdinHookCommand('start')),
    ]);
    expect(settings.hooks.PostToolUseFailure).toEqual([
      buildNestedEntry(makeStdinHookCommand('error')),
    ]);
    expect(settings.hooks.PermissionRequest).toEqual([
      buildNestedEntry(makeStdinHookCommand('notification')),
    ]);
    expect(settings.hooks.Notification).toEqual([
      { hooks: [{ type: 'command', command: 'notify-user' }] },
      buildNestedEntry(makeStdinHookCommand('notification')),
    ]);
    expect(settings.hooks.Stop).toEqual([buildNestedEntry(makeStdinHookCommand('stop'))]);
    expect(settings.hooks.SessionEnd).toBeUndefined();

    await expect(provider.behavior.hooks!.getHooksInstalled(fs)).resolves.toBe(true);

    await provider.behavior.hooks!.deleteHooks(fs);

    const cleanedSettings = JSON.parse(files.get(CODEBUDDY_SETTINGS_PATH)!);
    expect(cleanedSettings.language).toBe('English');
    expect(cleanedSettings.hooks.Notification).toEqual([
      { hooks: [{ type: 'command', command: 'notify-user' }] },
    ]);
    expect(JSON.stringify(cleanedSettings)).not.toContain('EMDASH_HOOK_PORT');
    await expect(provider.behavior.hooks!.getHooksInstalled(fs)).resolves.toBe(false);
  });

  it('does not overwrite malformed CodeBuddy settings during installation or removal', async () => {
    const malformedSettings = '{ "language": "English",';
    const files = new Map([[CODEBUDDY_SETTINGS_PATH, malformedSettings]]);
    const fs = createMemoryFs(files);

    await expect(provider.behavior.hooks!.writeHooks(fs, [])).rejects.toThrow(
      `Cannot update ${CODEBUDDY_SETTINGS_PATH}: file contains invalid JSON`
    );
    expect(files.get(CODEBUDDY_SETTINGS_PATH)).toBe(malformedSettings);

    await expect(provider.behavior.hooks!.deleteHooks(fs)).rejects.toThrow(
      `Cannot update ${CODEBUDDY_SETTINGS_PATH}: file contains invalid JSON`
    );
    expect(files.get(CODEBUDDY_SETTINGS_PATH)).toBe(malformedSettings);
  });

  it.each([
    {
      eventType: 'notification',
      body: {
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash',
      },
      expected: {
        kind: 'status',
        type: 'notification',
        notificationType: 'permission_prompt',
        title: 'Permission Required',
        message: 'CodeBuddy Code is requesting permission to use Bash.',
      },
    },
    {
      eventType: 'notification',
      body: {
        hook_event_name: 'Notification',
        notification_type: 'idle_prompt',
        message: 'CodeBuddy is waiting for input',
      },
      expected: {
        kind: 'status',
        type: 'notification',
        notificationType: 'idle_prompt',
        lastAssistantMessage: undefined,
        title: undefined,
        message: 'CodeBuddy is waiting for input',
      },
    },
    {
      eventType: 'session',
      body: {
        hook_event_name: 'SessionStart',
        session_id: 'codebuddy-session-id',
      },
      expected: {
        kind: 'session',
        providerSessionId: 'codebuddy-session-id',
      },
    },
    {
      eventType: 'start',
      body: { hook_event_name: 'PreToolUse' },
      expected: {
        kind: 'status',
        type: 'start',
        lastAssistantMessage: undefined,
        title: undefined,
        message: undefined,
      },
    },
    {
      eventType: 'error',
      body: { hook_event_name: 'PostToolUseFailure', message: 'Tool failed' },
      expected: {
        kind: 'status',
        type: 'error',
        lastAssistantMessage: undefined,
        title: undefined,
        message: 'Tool failed',
      },
    },
    {
      eventType: 'stop',
      body: { hook_event_name: 'Stop', last_assistant_message: 'Done' },
      expected: {
        kind: 'status',
        type: 'stop',
        lastAssistantMessage: 'Done',
        title: undefined,
        message: undefined,
      },
    },
  ])('normalizes $body.hook_event_name hook payloads', ({ eventType, body, expected }) => {
    expect(provider.behavior.hooks!.parseHookEvent!(eventType, body)).toEqual(expected);
  });
});
