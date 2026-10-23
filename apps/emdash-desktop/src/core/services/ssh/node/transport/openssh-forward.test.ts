import { EventEmitter } from 'node:events';
import { existsSync, writeFileSync } from 'node:fs';
import { PassThrough, type Duplex } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenSshClient } from './openssh-client';

const processes = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock('node:child_process', () => processes);
vi.mock('node:net', () => ({
  createConnection: (): PassThrough => {
    const channel = new PassThrough();
    queueMicrotask(() => channel.emit('connect'));
    return channel;
  },
}));

type Control = {
  args: string[];
  reply: (error: Error | null, stdout: string, stderr: string) => void;
};
const cleanup: Array<() => void> = [];
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose();
});

function fixture(): { client: OpenSshClient; commands: Control[]; errors: Error[] } {
  const master = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  processes.spawn.mockReturnValue(master);
  const commands: Control[] = [];
  processes.execFile.mockImplementation(
    (_file: string, args: string[], _opts: unknown, reply: Control['reply']) => {
      commands.push({ args, reply });
    }
  );
  const client = new OpenSshClient({ host: 'test.example', port: 22, username: 'test' });
  const errors: Error[] = [];
  client.on('error', (error: Error) => errors.push(error));
  cleanup.push(() => client.destroy());
  client.connect({});
  const args = processes.spawn.mock.calls[0]![1] as string[];
  const marker = args.at(-1)!.match(/emdash-ready-[a-f0-9-]+/)![0];
  master.stdout.write(`${marker}\n`);
  return { client, commands, errors };
}

function open(client: OpenSshClient, path = '/tmp/workspace.sock'): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    client.openssh_forwardOutStreamLocal(path, (error, channel) => {
      if (error) reject(error);
      else if (channel) resolve(channel);
      else reject(new Error('Missing channel'));
    });
  });
}

function listener(command: Control): string {
  return command.args[command.args.indexOf('-L') + 1]!.split(':')[0]!;
}

async function cancelRequest(commands: Control[], index: number): Promise<Control> {
  await vi.waitFor(() => expect(commands[index]?.args).toContain('cancel'));
  return commands[index]!;
}

describe('OpenSSH forwarding recovery', () => {
  it.each(['temporary failure', 'timed out'])(
    'cleans up a %s before allowing a shared retry',
    async (message) => {
      const { client, commands } = fixture();
      const first = expect(open(client)).rejects.toThrow(message);
      const second = expect(open(client)).rejects.toThrow(message);
      expect(commands).toHaveLength(1);
      const stale = listener(commands[0]!);
      writeFileSync(stale, 'fixture-listener');
      commands[0]!.reply(new Error(message), '', '');
      const cancel = await cancelRequest(commands, 1);
      const duringCleanup = expect(open(client)).rejects.toThrow(message);
      expect(commands).toHaveLength(2);
      expect(listener(cancel)).toBe(stale);
      cancel.reply(null, '', '');
      await Promise.all([first, second, duringCleanup]);
      expect(existsSync(stale)).toBe(false);
      const retry = open(client);
      const shared = open(client);
      expect(commands).toHaveLength(3);
      expect(listener(commands[2]!)).not.toBe(stale);
      commands[2]!.reply(null, '', '');
      for (const channel of await Promise.all([retry, shared])) channel.destroy();
    }
  );

  it('does not reuse another successful forward path after evicting a failed entry', async () => {
    const { client, commands } = fixture();
    const first = expect(open(client, '/tmp/a.sock')).rejects.toThrow('failed');
    const second = open(client, '/tmp/b.sock');
    const retained = listener(commands[1]!);
    commands[1]!.reply(null, '', '');
    (await second).destroy();
    commands[0]!.reply(new Error('failed'), '', '');
    (await cancelRequest(commands, 2)).reply(null, '', '');
    await first;
    const retry = open(client, '/tmp/a.sock');
    expect(listener(commands[3]!)).not.toBe(retained);
    commands[3]!.reply(null, '', '');
    (await retry).destroy();
    (await open(client, '/tmp/b.sock')).destroy();
    expect(commands).toHaveLength(4);
  });

  it('treats an absent listener as cleaned up and retains the physical connection', async () => {
    const { client, commands, errors } = fixture();
    const failed = expect(open(client)).rejects.toThrow('unavailable');
    commands[0]!.reply(new Error('unavailable'), '', '');
    (await cancelRequest(commands, 1)).reply(
      new Error('exit 255'),
      '',
      'mux_client_forward: forwarding request failed: port not forwarded\n'
    );
    await failed;
    expect(errors).toEqual([]);
    const retry = open(client);
    commands[2]!.reply(null, '', '');
    (await retry).destroy();
  });

  it('retires the connection when cancellation cannot establish a clean state', async () => {
    const { client, commands, errors } = fixture();
    const closed = vi.fn();
    client.on('close', closed);
    const failed = expect(open(client)).rejects.toThrow('cleanup failed');
    commands[0]!.reply(new Error('timed out'), '', '');
    (await cancelRequest(commands, 1)).reply(new Error('timed out'), '', '');
    await failed;
    expect(closed).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(1);
    await expect(open(client)).rejects.toThrow('not available');
    expect(commands).toHaveLength(2);
  });

  it.each([
    { reply: null, message: 'closed' },
    { reply: new Error('aborted'), message: 'aborted' },
  ])('does not publish late $message results after destroy', async ({ reply, message }) => {
    const { client, commands, errors } = fixture();
    const failed = expect(open(client)).rejects.toThrow(message);
    client.destroy();
    commands[0]!.reply(reply, '', '');
    await failed;
    expect(commands).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it('does not report a second transport error when destroy aborts cancellation', async () => {
    const { client, commands, errors } = fixture();
    const failed = expect(open(client)).rejects.toThrow('forward failed');
    commands[0]!.reply(new Error('forward failed'), '', '');
    const cancel = await cancelRequest(commands, 1);
    client.destroy();
    cancel.reply(new Error('aborted'), '', '');
    await failed;
    expect(commands).toHaveLength(2);
    expect(errors).toEqual([]);
  });
});
