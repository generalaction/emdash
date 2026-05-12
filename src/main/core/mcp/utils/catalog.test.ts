import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mcpInternalService } from '@main/core/mcp-internal';
import { loadCatalog } from './catalog';

vi.mock('@shared/mcp/catalog', () => ({
  catalogData: {
    emdash: {
      name: 'Emdash',
      description: 'Internal MCP',
      docsUrl: 'https://example.com/emdash',
      config: { command: 'fallback', args: ['fallback.js'], env: { FALLBACK: '1' } },
      credentialKeys: [],
    },
    other: {
      name: 'Other',
      description: 'Other MCP',
      docsUrl: 'https://example.com/other',
      config: { command: 'other', args: ['server.js'] },
      credentialKeys: [],
    },
  },
}));

vi.mock('@main/core/mcp-internal', () => ({
  mcpInternalService: {
    getCanonicalRawConfig: vi.fn(),
  },
}));

const mockGetCanonicalRawConfig = vi.mocked(mcpInternalService.getCanonicalRawConfig);

describe('loadCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the full live canonical config for emdash catalog entries', () => {
    mockGetCanonicalRawConfig.mockReturnValue({
      command: 'node',
      args: ['server.js'],
      env: { EMDASH_TOKEN: 'secret' },
      passthroughEnv: ['EMDASH_SESSION_ID', 'EMDASH_TASK_ID'],
    });

    const catalog = loadCatalog();
    const emdash = catalog.find((entry) => entry.key === 'emdash');

    expect(emdash?.defaultConfig).toEqual({
      command: 'node',
      args: ['server.js'],
      env: { EMDASH_TOKEN: 'secret' },
      passthroughEnv: ['EMDASH_SESSION_ID', 'EMDASH_TASK_ID'],
    });
  });

  it('falls back to static config when live canonical config is unavailable', () => {
    mockGetCanonicalRawConfig.mockReturnValue(null);

    const catalog = loadCatalog();
    const emdash = catalog.find((entry) => entry.key === 'emdash');

    expect(emdash?.defaultConfig).toEqual({
      command: 'fallback',
      args: ['fallback.js'],
      env: { FALLBACK: '1' },
    });
  });
});
