import { ChildAcpProcessHost, AgentTerminalManager } from '@emdash/core/runtimes/acp/node';
import { describe, expect, it } from 'vitest';
import { provider } from './index';

describe('Devin ACP terminal commands', () => {
  const command = 'ls && ls src && ls src/app 2>/dev/null | head -30';

  it.each([undefined, []])(
    'treats commands without arguments as explicit shell scripts',
    (args) => {
      expect(provider.behavior.acp!.terminalCommand!({ command, args })).toEqual({
        kind: 'shell-line',
        commandLine: command,
      });
    }
  );

  it('preserves explicit executable paths and literal argv', () => {
    const request = { command: '/path with spaces/node', args: ['&&', '$HOME', 'hello world'] };
    expect(provider.behavior.acp!.terminalCommand!(request)).toEqual({ kind: 'argv', ...request });
  });

  it.skipIf(process.platform === 'win32')(
    'runs the reported request without losing the terminal host',
    async () => {
      const manager = new AgentTerminalManager(new ChildAcpProcessHost(), {
        onTerminalCreated: () => {},
        onTerminalOutput: () => {},
        onTerminalExit: () => {},
        onTerminalReleased: () => {},
      });
      try {
        const id = await manager.create('devin', {
          command: provider.behavior.acp!.terminalCommand!({ command, args: [] }),
          cwd: process.cwd(),
          env: { PATH: '/usr/bin:/bin' },
        });
        await expect(manager.get(id)!.waitForExit()).resolves.toEqual({
          exitCode: 0,
          signal: null,
        });
        expect(manager.get(id)!.outputSnapshot().output).toContain('package.json');
      } finally {
        await manager.killAll();
      }
    }
  );
});
