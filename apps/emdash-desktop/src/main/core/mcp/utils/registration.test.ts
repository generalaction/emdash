import { describe, expect, it } from 'vitest';
import { mcpServerToRegistration, registrationToMcpServer } from './registration';

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
});
