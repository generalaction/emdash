import type { CLIAgentPluginMetadata } from 'cli-agent-plugins';
import { describe, expect, it, vi } from 'vitest';
import type { DependencyStatusMap } from '@shared/core/dependencies';

vi.mock('cli-agent-plugins/metadata', () => ({
  metadataRegistry: {
    get: vi.fn(),
    getAll: vi.fn(),
  },
}));

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

const { metadataRegistry } = await import('cli-agent-plugins/metadata');
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
          macos: { command: `brew install ${id}`, method: 'homebrew' },
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
    },
  };
}

const defaultSettings = (cli: string) => ({
  value: { cli },
  defaults: { cli },
  overrides: {},
});

describe('buildAgentPayload', () => {
  it('merges metadata, AGENT_PROVIDERS icons, status and settings into a payload', async () => {
    vi.mocked(metadataRegistry.get).mockReturnValue(makeMetadata('claude', 'claude'));
    vi.mocked(providerOverrideSettings.getItemWithMeta).mockResolvedValue(
      defaultSettings('claude')
    );

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
    expect(payload!.command).toBe('/usr/local/bin/claude');
    expect(payload!.iconName).toBe('claude.svg');
    expect(payload!.invertInDark).toBe(false);
    expect(payload!.settings.defaults.cli).toBe('claude');
    expect(payload!.capabilities.models).toEqual({ kind: 'none' });
    expect(payload!.capabilities.effort).toEqual({ kind: 'none' });
  });

  it('uses missing status when agent is not in the status map', async () => {
    vi.mocked(metadataRegistry.get).mockReturnValue(makeMetadata('claude', 'claude'));
    vi.mocked(providerOverrideSettings.getItemWithMeta).mockResolvedValue(
      defaultSettings('claude')
    );

    const { buildAgentPayload } = await import('./agent-payload-builder');
    const payload = await buildAgentPayload('claude', {});

    expect(payload!.status).toBe('missing');
    expect(payload!.version).toBeNull();
    expect(payload!.command).toBeNull();
  });

  it('returns null when there is no plugin metadata for the id', async () => {
    vi.mocked(metadataRegistry.get).mockReturnValue(undefined);
    vi.mocked(providerOverrideSettings.getItemWithMeta).mockResolvedValue(null);

    const { buildAgentPayload } = await import('./agent-payload-builder');
    const payload = await buildAgentPayload('unknown-agent', {});

    expect(payload).toBeNull();
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
    vi.mocked(providerOverrideSettings.getItemWithMeta).mockResolvedValue(defaultSettings('codex'));

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
    vi.mocked(providerOverrideSettings.getItemWithMeta).mockResolvedValue(defaultSettings('cli'));

    const { buildAgentPayloads } = await import('./agent-payload-builder');
    const payloads = await buildAgentPayloads({});

    expect(payloads).toHaveLength(2);
    expect(payloads.map((p) => p.id)).toEqual(['claude', 'codex']);
  });
});
