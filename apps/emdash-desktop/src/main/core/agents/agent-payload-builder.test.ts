import type { CLIAgentPluginMetadata } from '@emdash/cli-agent-plugins';
import { describe, expect, it, vi } from 'vitest';
import type { DependencyStatusMap } from '@shared/core/dependencies';

vi.mock('@emdash/cli-agent-plugins/metadata', () => ({
  metadataRegistry: {
    get: vi.fn(),
    getAll: vi.fn().mockReturnValue([]),
  },
}));

vi.mock('../dependencies/registry', async () => {
  const { metadataRegistry: mr } = await import('@emdash/cli-agent-plugins/metadata');
  return {
    getDependencyDescriptor: vi.fn().mockImplementation((id: string) => {
      const m = mr.get(id as never);
      if (!m) return undefined;
      return {
        id: m.id,
        name: m.name,
        category: 'agent' as const,
        commands: m.capabilities.install.binaryNames,
        versionArgs: ['--version'],
        docUrl: m.websiteUrl,
        installCommands: m.capabilities.install.installCommands,
        updates: m.capabilities.updates,
      };
    }),
    DEPENDENCIES: [],
  };
});

vi.mock('@shared/core/agents/agent-provider-registry', () => ({
  AGENT_PROVIDERS: [
    {
      id: 'claude',
      name: 'Claude Code',
      icon: 'claude.svg',
      iconDark: undefined,
      invertInDark: false,
      alt: 'Claude Code',
    },
    {
      id: 'codex',
      name: 'Codex',
      icon: 'openai.svg',
      iconDark: undefined,
      invertInDark: true,
      alt: 'Codex',
    },
  ],
}));

vi.mock('../settings/provider-settings-service', () => ({
  providerOverrideSettings: {
    getItemWithMeta: vi.fn(),
  },
}));

const { metadataRegistry } = await import('@emdash/cli-agent-plugins/metadata');
const { providerOverrideSettings } = await import('../settings/provider-settings-service');

function makeMetadata(id: string, binaryName: string): CLIAgentPluginMetadata {
  return {
    id,
    name: `${id} name`,
    description: `${id} description`,
    websiteUrl: `https://${id}.example.com`,
    capabilities: {
      install: {
        binaryNames: [binaryName],
        installCommands: {
          macos: [{ command: `brew install ${id}`, method: 'homebrew' }],
        },
      },
      models: { kind: 'none' },
      effort: { kind: 'none' },
      promptDelivery: { kind: 'argv', flag: '' },
      sessions: { kind: 'resumable' },
      autoApprove: { kind: 'supported' },
      hooks: { kind: 'none' },
      mcp: { kind: 'none' },
      plugin: { kind: 'none' },
      updates: { kind: 'none' },
    },
  };
}

const defaultSettings = () => ({
  value: {},
  defaults: {},
  overrides: {},
});

describe('buildAgentPayload', () => {
  it('merges metadata, AGENT_PROVIDERS icons, status and settings into a payload', async () => {
    vi.mocked(metadataRegistry.get).mockReturnValue(makeMetadata('claude', 'claude'));
    vi.mocked(providerOverrideSettings.getItemWithMeta).mockResolvedValue(defaultSettings());

    const statuses: DependencyStatusMap = {
      claude: {
        id: 'claude',
        category: 'agent',
        status: 'available',
        version: '1.2.0',
        path: '/usr/local/bin/claude',
        checkedAt: 1,
      },
    };

    const { buildAgentPayload } = await import('./agent-payload-builder');
    const payload = await buildAgentPayload('claude', statuses);

    expect(payload).not.toBeNull();
    expect(payload!.id).toBe('claude');
    expect(payload!.name).toBe('claude name');
    expect(payload!.status).toBe('available');
    expect(payload!.version).toBe('1.2.0');
    expect(payload!.latestVersion).toBeNull();
    expect(payload!.updateAvailable).toBe(false);
    expect(payload!.command).toBe('/usr/local/bin/claude');
    expect(payload!.settings).toBeDefined();
    expect(payload!.capabilities.models).toEqual({ kind: 'none' });
    expect(payload!.capabilities.effort).toEqual({ kind: 'none' });
    expect(payload!.capabilities.updates).toEqual({ kind: 'none' });
    // installOptions is resolved for the current platform (macos in CI/dev)
    expect(Array.isArray(payload!.installOptions)).toBe(true);
    // installDocs is null when not set on the plugin
    expect(payload!.installDocs).toBeNull();
    // updateCommand is undefined on each option when updates.kind === 'none'
    for (const opt of payload!.installOptions) {
      expect(opt.updateCommand).toBeUndefined();
    }
  });

  it('uses missing status when agent is not in the status map', async () => {
    vi.mocked(metadataRegistry.get).mockReturnValue(makeMetadata('claude', 'claude'));
    vi.mocked(providerOverrideSettings.getItemWithMeta).mockResolvedValue(defaultSettings());

    const { buildAgentPayload } = await import('./agent-payload-builder');
    const payload = await buildAgentPayload('claude', {});

    expect(payload!.status).toBe('missing');
    expect(payload!.version).toBeNull();
    expect(payload!.latestVersion).toBeNull();
    expect(payload!.updateAvailable).toBe(false);
    expect(payload!.command).toBeNull();
  });

  it('returns null when there is no plugin metadata for the id', async () => {
    vi.mocked(metadataRegistry.get).mockReturnValue(undefined);
    vi.mocked(providerOverrideSettings.getItemWithMeta).mockResolvedValue(null);

    const { buildAgentPayload } = await import('./agent-payload-builder');
    const payload = await buildAgentPayload('unknown-agent', {});

    expect(payload).toBeNull();
  });

  it('resolves updateCommand per installOption for a cli update strategy', async () => {
    const meta = makeMetadata('claude', 'claude');
    (meta.capabilities as Record<string, unknown>).updates = {
      kind: 'supported',
      releaseSource: { kind: 'none' },
      update: { kind: 'cli', args: ['update'] },
    };
    vi.mocked(metadataRegistry.get).mockReturnValue(meta);
    vi.mocked(providerOverrideSettings.getItemWithMeta).mockResolvedValue(defaultSettings());

    const { buildAgentPayload } = await import('./agent-payload-builder');
    const payload = await buildAgentPayload('claude', {});

    // Each install option should carry the cli update command (binary + args)
    for (const opt of payload!.installOptions) {
      expect(opt.updateCommand).toBe('claude update');
    }
  });

  it('resolves updateCommand per installOption for a package-manager update strategy', async () => {
    const meta = makeMetadata('codex', 'codex');
    (meta.capabilities as Record<string, unknown>).updates = {
      kind: 'supported',
      releaseSource: { kind: 'none' },
      update: { kind: 'package-manager' },
    };
    vi.mocked(metadataRegistry.get).mockReturnValue(meta);
    vi.mocked(providerOverrideSettings.getItemWithMeta).mockResolvedValue(defaultSettings());

    const { buildAgentPayload } = await import('./agent-payload-builder');
    const payload = await buildAgentPayload('codex', {});

    // Each option's updateCommand defaults to re-running that option's install command
    for (const opt of payload!.installOptions) {
      expect(opt.updateCommand).toBe(opt.command);
    }
  });

  it('uses an explicit per-option updateCommand when provided', async () => {
    const meta = makeMetadata('codex', 'codex');
    (meta.capabilities.install.installCommands as Record<string, unknown>).macos = [
      { command: 'npm install -g codex', method: 'npm', updateCommand: 'npm update -g codex' },
    ];
    (meta.capabilities as Record<string, unknown>).updates = {
      kind: 'supported',
      releaseSource: { kind: 'none' },
      update: { kind: 'package-manager' },
    };
    vi.mocked(metadataRegistry.get).mockReturnValue(meta);
    vi.mocked(providerOverrideSettings.getItemWithMeta).mockResolvedValue(defaultSettings());

    const { buildAgentPayload } = await import('./agent-payload-builder');
    const payload = await buildAgentPayload('codex', {});

    const npmOpt = payload!.installOptions.find((o) => o.method === 'npm');
    expect(npmOpt?.updateCommand).toBe('npm update -g codex');
  });

  it('passes models and effort capabilities through verbatim', async () => {
    const meta = makeMetadata('codex', 'codex');
    (meta.capabilities as Record<string, unknown>).models = {
      kind: 'selectable',
      modelOptions: {
        'gpt-4o': {
          name: 'GPT-4o',
          description: 'Fast',
          modelFeatures: { contextWindowSize: 128000, speed: 5, intelligence: 5 },
        },
      },
    };
    vi.mocked(metadataRegistry.get).mockReturnValue(meta);
    vi.mocked(providerOverrideSettings.getItemWithMeta).mockResolvedValue(defaultSettings());

    const { buildAgentPayload } = await import('./agent-payload-builder');
    const payload = await buildAgentPayload('codex', {});

    expect(payload!.capabilities.models).toEqual({
      kind: 'selectable',
      modelOptions: expect.objectContaining({ 'gpt-4o': expect.any(Object) }),
    });
  });
});

describe('buildAgentPayloads', () => {
  it('returns one entry per AGENT_PROVIDERS entry', async () => {
    vi.mocked(metadataRegistry.get).mockImplementation((id) =>
      id === 'claude' || id === 'codex' ? makeMetadata(id, id) : undefined
    );
    vi.mocked(metadataRegistry.getAll).mockReturnValue([
      makeMetadata('claude', 'claude'),
      makeMetadata('codex', 'codex'),
    ]);
    vi.mocked(providerOverrideSettings.getItemWithMeta).mockResolvedValue(defaultSettings());

    const { buildAgentPayloads } = await import('./agent-payload-builder');
    const payloads = await buildAgentPayloads({});

    expect(payloads).toHaveLength(2);
    expect(payloads.map((p) => p.id)).toEqual(['claude', 'codex']);
  });
});
