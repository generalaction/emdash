import { describe, expect, it, vi } from 'vitest';
import type { AgentTerminalManager } from './terminal-manager';
import { TerminalPort } from './terminal-port';

describe('TerminalPort', () => {
  it('canonicalizes ACP terminal environment names on Windows', async () => {
    const create = vi.fn(async () => 'terminal-1');
    const port = new TerminalPort({ create } as unknown as AgentTerminalManager, 'win32');

    await expect(
      port.createTerminal('conversation-1', 'C:\\workspace', {
        sessionId: 'session-1',
        command: 'node',
        env: [
          { name: 'Path', value: 'C:\\base' },
          { name: 'pAtH', value: 'C:\\override' },
          { name: 'anthropic_api_key', value: 'secret' },
        ],
      })
    ).resolves.toEqual({ terminalId: 'terminal-1' });

    expect(create).toHaveBeenCalledWith('conversation-1', {
      command: 'node',
      args: [],
      env: {
        PATH: 'C:\\override',
        ANTHROPIC_API_KEY: 'secret',
      },
      cwd: 'C:\\workspace',
      outputByteLimit: undefined,
    });
  });
});
