import { describe, expect, it } from 'vitest';
import {
  mergeMcpServerRegistration,
  mcpServerFieldCount,
  mcpServerToRegistration,
  registrationToMcpServer,
} from './registration';

describe('MCP registration conversion', () => {
  it('preserves enabled state across canonical conversion', () => {
    const server = registrationToMcpServer(
      {
        name: 'inherited',
        enabled: false,
        cwd: './mcp',
        timeout: 10_000,
        oauth: false,
      },
      ['opencode']
    );

    expect(server).toEqual({
      name: 'inherited',
      transport: 'stdio',
      enabled: false,
      cwd: './mcp',
      timeout: 10_000,
      oauth: false,
      providers: ['opencode'],
    });

    expect(mcpServerToRegistration(server)).toEqual({
      name: 'inherited',
      transport: 'stdio',
      enabled: false,
      cwd: './mcp',
      timeout: 10_000,
      oauth: false,
    });
  });

  it('does not treat enabled=true as extra merge signal', () => {
    const implicitDefault = registrationToMcpServer({ name: 'docs', url: 'https://example.com' }, [
      'cursor',
    ]);
    const explicitDefault = registrationToMcpServer(
      { name: 'docs', url: 'https://example.com', enabled: true },
      ['grok']
    );
    const disabled = registrationToMcpServer(
      { name: 'docs', url: 'https://example.com', enabled: false },
      ['opencode']
    );

    expect(mcpServerFieldCount(explicitDefault)).toBe(mcpServerFieldCount(implicitDefault));
    expect(mcpServerFieldCount(disabled)).toBeGreaterThan(mcpServerFieldCount(implicitDefault));
  });

  it('retains provider-native fields while updating canonical fields', () => {
    const merged = mergeMcpServerRegistration(
      {
        name: 'remote',
        transport: 'http',
        url: 'https://old.example.com/mcp',
        auth: { type: 'oauth', scopes: ['tools:read'] },
        disabled: true,
        startup_timeout_sec: 15,
        envFile: '~/.continue/mcp.env',
      },
      {
        name: 'remote',
        transport: 'http',
        url: 'https://new.example.com/mcp',
        providers: ['mistral'],
      }
    );

    expect(merged).toMatchObject({
      name: 'remote',
      transport: 'http',
      type: 'http',
      url: 'https://new.example.com/mcp',
      auth: { type: 'oauth', scopes: ['tools:read'] },
      disabled: true,
      startup_timeout_sec: 15,
      envFile: '~/.continue/mcp.env',
    });
  });
});
