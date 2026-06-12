import type { CLIAgentPluginProvider } from '@emdash/shared/agents/plugins';
import type { DependencyState } from '@emdash/shared/deps/runtime';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@emdash/cli-agent-plugins/registry', () => ({
  pluginRegistry: {
    get: vi.fn(),
    getAll: vi.fn().mockReturnValue([]),
    ids: vi.fn().mockReturnValue([]),
  },
}));

vi.mock('@main/core/agents/plugin-registry', () => ({
  getPlugin: vi.fn(),
  listPlugins: vi.fn().mockReturnValue([]),
}));

vi.mock('@main/core/dependencies/registry', () => ({
  getDependencyDescriptor: vi.fn().mockReturnValue(undefined),
  DEPENDENCIES: [],
}));

vi.mock('@shared/core/agents/agent-provider-registry', () => ({
  AGENT_PROVIDERS: [{ id: 'claude' }, { id: 'codex' }],
}));

vi.mock('../settings/provider-settings-service', () => ({
  providerOverrideSettings: {
    getItemWithMeta: vi.fn(),
  },
}));

const { getPlugin } = await import('@main/core/agents/plugin-registry');
const { providerOverrideSettings } = await import('../settings/provider-settings-service');
void (await import('@main/core/dependencies/registry'));

const dummyIcon = {
  variants: [{ svg: '<svg/>', minSize: 0, maxSize: Infinity }],
  invertInDark: false,
};

function makeProvider(id: string, binaryName: string): CLIAgentPluginProvider {
  return {
    metadata: {
      id,
      name: `${id} name`,
      description: `${id} description`,
      websiteUrl: `https://${id}.example.com`,
    },
    capabilities: {
      hostDependency: {
        binaryNames: [binaryName],
        installCommands: {
          macos: [{ command: `brew install ${id}`, method: 'homebrew' }],
        },
        updates: { kind: 'none' },
      },
      models: { kind: 'none' },
      effort: { kind: 'none' },
      prompt: { kind: 'argv', flag: '' },
      sessions: { kind: 'resumable' },
      autoApprove: { kind: 'supported' },
      hooks: { kind: 'none' },
      mcp: { kind: 'none' },
      plugins: { kind: 'none' },
    },
    assets: { icon: dummyIcon },
    behavior: {
      prompt: { buildCommand: vi.fn() },
    },
    validate: () => [],
  } as unknown as CLIAgentPluginProvider;
}

function makeDependencyManager(states: Record<string, Partial<DependencyState>>) {
  return {
    get: vi.fn((id: string) => states[id] ?? undefined),
    getAll: vi.fn(() => {
      const m = new Map<string, DependencyState>();
      for (const [k, v] of Object.entries(states)) m.set(k, v as DependencyState);
      return m;
    }),
    getHostDependency: vi.fn(() => undefined),
    platform: 'macos' as const,
  };
}

const defaultSettings = () => ({
  value: {},
  defaults: {},
  overrides: {},
});

describe('buildAgentPayload', () => {
  it('merges provider, status and settings into a payload', async () => {
    vi.mocked(getPlugin).mockReturnValue(makeProvider('claude', 'claude'));
    vi.mocked(providerOverrideSettings.getItemWithMeta).mockResolvedValue(defaultSettings());

    const mgr = makeDependencyManager({
      claude: {
        id: 'claude',
        category: 'agent',
        status: 'available',
        version: '1.2.0',
        path: '/usr/local/bin/claude',
        checkedAt: 1,
      },
    });

    const { buildAgentPayload } = await import('./agent-payload-builder');
    const payload = await buildAgentPayload('claude', 'macos', mgr as never);

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
    expect(Array.isArray(payload!.installOptions)).toBe(true);
    expect(payload!.installDocs).toBeNull();
  });

  it('uses missing status when agent is not in the dependency manager', async () => {
    vi.mocked(getPlugin).mockReturnValue(makeProvider('claude', 'claude'));
    vi.mocked(providerOverrideSettings.getItemWithMeta).mockResolvedValue(defaultSettings());

    const mgr = makeDependencyManager({});

    const { buildAgentPayload } = await import('./agent-payload-builder');
    const payload = await buildAgentPayload('claude', 'macos', mgr as never);

    expect(payload!.status).toBe('missing');
    expect(payload!.version).toBeNull();
    expect(payload!.latestVersion).toBeNull();
    expect(payload!.updateAvailable).toBe(false);
    expect(payload!.command).toBeNull();
  });

  it('returns null when there is no plugin for the id', async () => {
    vi.mocked(getPlugin).mockImplementation(() => {
      throw new Error('No plugin found');
    });
    vi.mocked(providerOverrideSettings.getItemWithMeta).mockResolvedValue(null);

    const { buildAgentPayload } = await import('./agent-payload-builder');
    await expect(buildAgentPayload('unknown-agent')).rejects.toThrow('No plugin found');
  });

  it('passes models capability through verbatim', async () => {
    const provider = makeProvider('codex', 'codex');
    (provider.capabilities as Record<string, unknown>).models = {
      kind: 'selectable',
      modelOptions: {
        'gpt-4o': {
          name: 'GPT-4o',
          description: 'Fast',
          modelFeatures: { contextWindowSize: 128000, speed: 5, intelligence: 5 },
        },
      },
    };
    vi.mocked(getPlugin).mockReturnValue(provider);
    vi.mocked(providerOverrideSettings.getItemWithMeta).mockResolvedValue(defaultSettings());

    const { buildAgentPayload } = await import('./agent-payload-builder');
    const payload = await buildAgentPayload('codex');

    expect(payload!.capabilities.models).toEqual({
      kind: 'selectable',
      modelOptions: expect.objectContaining({ 'gpt-4o': expect.any(Object) }),
    });
  });
});

describe('buildAgentPayloads', () => {
  it('returns one entry per AGENT_PROVIDERS entry', async () => {
    vi.mocked(getPlugin).mockImplementation((id) => makeProvider(id, id));
    vi.mocked(providerOverrideSettings.getItemWithMeta).mockResolvedValue(defaultSettings());

    const { buildAgentPayloads } = await import('./agent-payload-builder');
    const payloads = await buildAgentPayloads();

    expect(payloads).toHaveLength(2);
    expect(payloads.map((p) => p.id)).toEqual(['claude', 'codex']);
  });
});
