import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentTerminalManager } from '../agent-ports/terminal-manager';
import { ChildAcpProcessHost } from './child-process-host';

describe('ACP terminal process lifecycle', () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('keeps shell metacharacters literal in argv requests', async () => {
    const args = ['hello world', '&&', '$HOME', '$(echo expanded)', '>output', ''];
    const terminal = await new ChildAcpProcessHost().spawnTerminal({
      command: {
        kind: 'argv',
        command: process.execPath,
        args: ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...args],
      },
      cwd: process.cwd(),
      env: {},
    });
    cleanups.push(async () => {
      await terminal.kill();
    });
    let output = '';
    terminal.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    await new Promise((resolve) => terminal.onExit(resolve));
    expect(JSON.parse(output)).toEqual(args);
  });

  it.skipIf(process.platform === 'win32')(
    'executes explicit shell scripts with pipes and redirects',
    async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'emdash-acp-terminal-'));
      cleanups.push(() => rm(cwd, { recursive: true, force: true }));
      const host = new ChildAcpProcessHost();
      const terminal = await host.spawnTerminal({
        command: {
          kind: 'shell-line',
          commandLine: 'printf first > result && cat result | tr a-z A-Z',
        },
        cwd,
        env: { PATH: '/usr/bin:/bin' },
      });
      cleanups.push(async () => {
        await terminal.kill();
      });
      let output = '';
      terminal.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });
      const status = await new Promise((resolve) => terminal.onExit(resolve));
      expect(status).toEqual({ exitCode: 0, signal: null });
      expect(output).toBe('FIRST');
    }
  );

  it.each(['executable', 'cwd', ...(process.platform === 'win32' ? [] : ['permission'])])(
    'rejects a terminal startup failure (%s) and can run another terminal',
    async (missing) => {
      const cwd = await mkdtemp(join(tmpdir(), 'emdash-acp-terminal-'));
      cleanups.push(() => rm(cwd, { recursive: true, force: true }));
      if (missing === 'permission')
        await writeFile(join(cwd, 'missing'), '#!/bin/sh\n', { mode: 0o600 });
      const created: string[] = [];
      const manager = new AgentTerminalManager(new ChildAcpProcessHost(), {
        onTerminalCreated: ({ terminalId }) => created.push(terminalId),
        onTerminalOutput: () => {},
        onTerminalExit: () => {},
        onTerminalReleased: () => {},
      });
      cleanups.push(() => manager.killAll());
      await expect(
        manager.create('failed', {
          command: {
            kind: 'argv',
            command: missing === 'cwd' ? process.execPath : join(cwd, 'missing'),
            args: [],
          },
          cwd: missing === 'cwd' ? join(cwd, 'missing') : cwd,
          env: {},
        })
      ).rejects.toMatchObject({ code: missing === 'permission' ? 'EACCES' : 'ENOENT' });
      expect(created).toEqual([]);
      expect(manager.listAll()).toEqual([]);

      const id = await manager.create('healthy', {
        command: {
          kind: 'argv',
          command: process.execPath,
          args: ['-e', 'process.stdout.write("still alive")'],
        },
        cwd,
        env: {},
      });
      const terminal = manager.get(id)!;
      await expect(terminal.waitForExit()).resolves.toEqual({ exitCode: 0, signal: null });
      expect(terminal.outputSnapshot().output).toBe('still alive');
    }
  );
});
