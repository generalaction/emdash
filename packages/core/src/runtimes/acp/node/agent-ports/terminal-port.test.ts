import { describe, expect, it, vi } from 'vitest';
import type { AgentTerminalManager } from './terminal-manager';
import { TerminalPort } from './terminal-port';

describe('TerminalPort', () => {
  it('applies the canonical terminal environment policy', async () => {
    const create = vi.fn(async () => 'terminal-1');
    const port = new TerminalPort({ create } as unknown as AgentTerminalManager);

    await port.createTerminal(
      'conversation-1',
      '/workspace',
      { PATH: '/bin', ENV_TEST: 'inherited' },
      { sessionId: 'session-1', command: 'node' }
    );

    expect(create).toHaveBeenCalledWith(
      'conversation-1',
      expect.objectContaining({
        env: expect.objectContaining({
          PATH: '/bin',
          ENV_TEST: 'inherited',
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          TERM_PROGRAM: 'emdash',
          HOME: expect.any(String),
        }),
      })
    );
  });

  it('canonicalizes ACP terminal environment names on Windows', async () => {
    const create = vi.fn(async () => 'terminal-1');
    const port = new TerminalPort({ create } as unknown as AgentTerminalManager, 'win32');

    await expect(
      port.createTerminal(
        'conversation-1',
        'C:\\workspace',
        { Path: 'C:\\agent', ENV_TEST: 'inherited' },
        {
          sessionId: 'session-1',
          command: 'node',
          env: [
            { name: 'Path', value: 'C:\\base' },
            { name: 'pAtH', value: 'C:\\override' },
            { name: 'anthropic_api_key', value: 'secret' },
          ],
        }
      )
    ).resolves.toEqual({ terminalId: 'terminal-1' });

    expect(create).toHaveBeenCalledWith(
      'conversation-1',
      expect.objectContaining({
        command: 'node',
        args: [],
        env: expect.objectContaining({
          PATH: 'C:\\override',
          ENV_TEST: 'inherited',
          ANTHROPIC_API_KEY: 'secret',
        }),
        cwd: 'C:\\workspace',
        outputByteLimit: undefined,
      })
    );

    const call = create.mock.calls[0] as unknown as Parameters<AgentTerminalManager['create']>;
    expect(Object.keys(call[1].env).filter((key) => key.toLowerCase() === 'path')).toEqual([
      'PATH',
    ]);
  });
});
