import type { CommandContext, PluginFs } from '@emdash/core/agents/plugins';
import { buildNestedEntry, makeStdinHookCommand } from '@emdash/core/agents/plugins/helpers';
import { describe, expect, it } from 'vitest';
import { CODEBUDDY_EMDASH_HOOKS_PATH } from './hooks';
import { provider } from './index';

const baseContext: CommandContext = {
  cli: 'codebuddy',
  autoApprove: false,
  hooksEnabled: true,
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
        '--settings',
        CODEBUDDY_EMDASH_HOOKS_PATH,
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
      args: [
        '--settings',
        CODEBUDDY_EMDASH_HOOKS_PATH,
        '--resume',
        '550e8400-e29b-41d4-a716-446655440000',
        '--dangerously-skip-permissions',
      ],
      env: {},
    });
  });

  it('does not reference hook settings when provisioning failed', () => {
    expect(build({ hooksEnabled: false }).args).not.toContain('--settings');
  });

  it.each([['--settings', 'custom.json'], ['--settings=custom.json']])(
    'rejects a conflicting %s additional parameter when hooks are enabled',
    (...extraArgs) => {
      expect(() => build({ extraArgs })).toThrow(
        'CodeBuddy additional parameters cannot include --settings while Emdash hooks are enabled'
      );
    }
  );

  it('allows custom hook settings when hook provisioning failed', () => {
    expect(build({ hooksEnabled: false, extraArgs: ['--settings', 'custom.json'] }).args).toContain(
      'custom.json'
    );
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

  it('installs lifecycle hooks in a dedicated Emdash settings overlay', async () => {
    const userSettings = '{ "language": "English",';
    const files = new Map<string, string>([['.codebuddy/settings.local.json', userSettings]]);
    const fs = createMemoryFs(files);

    await expect(provider.behavior.hooks!.writeHooks(fs, [])).resolves.toEqual([
      CODEBUDDY_EMDASH_HOOKS_PATH,
    ]);
    await provider.behavior.hooks!.writeHooks(fs, []);

    expect(files.get('.codebuddy/settings.local.json')).toBe(userSettings);
    const settings = JSON.parse(files.get(CODEBUDDY_EMDASH_HOOKS_PATH)!);
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
      buildNestedEntry(makeStdinHookCommand('notification')),
    ]);
    expect(settings.hooks.Stop).toEqual([buildNestedEntry(makeStdinHookCommand('stop'))]);
    expect(settings.hooks.SessionEnd).toBeUndefined();

    await expect(provider.behavior.hooks!.getHooksInstalled(fs)).resolves.toBe(true);

    await provider.behavior.hooks!.deleteHooks(fs);

    expect(files.get('.codebuddy/settings.local.json')).toBe(userSettings);
    const cleanedSettings = JSON.parse(files.get(CODEBUDDY_EMDASH_HOOKS_PATH)!);
    expect(cleanedSettings.hooks.Notification).toEqual([]);
    expect(JSON.stringify(cleanedSettings)).not.toContain('EMDASH_HOOK_PORT');
    await expect(provider.behavior.hooks!.getHooksInstalled(fs)).resolves.toBe(false);
  });

  it.each([
    ['malformed JSON', '{ "hooks": {', 'file contains invalid JSON'],
    ['an empty file', '', 'file contains invalid JSON'],
    ['a non-object root', '[]', 'expected a JSON object'],
  ])('does not overwrite an Emdash hooks overlay containing %s', async (_case, content, error) => {
    const files = new Map([[CODEBUDDY_EMDASH_HOOKS_PATH, content]]);
    const fs = createMemoryFs(files);

    await expect(provider.behavior.hooks!.writeHooks(fs, [])).rejects.toThrow(
      `Cannot update ${CODEBUDDY_EMDASH_HOOKS_PATH}: ${error}`
    );
    expect(files.get(CODEBUDDY_EMDASH_HOOKS_PATH)).toBe(content);

    await expect(provider.behavior.hooks!.deleteHooks(fs)).rejects.toThrow(
      `Cannot update ${CODEBUDDY_EMDASH_HOOKS_PATH}: ${error}`
    );
    expect(files.get(CODEBUDDY_EMDASH_HOOKS_PATH)).toBe(content);
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
