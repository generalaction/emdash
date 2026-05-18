import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProxyJumpSocket } from './proxy-jump-sock';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

type MockChild = EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
};

function makeMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });
  return child;
}

describe('buildProxyJumpSocket', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('spawns ssh with -W target and parsed jump port', () => {
    const child = makeMockChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    buildProxyJumpSocket('target.internal', 2202, 'jumpuser@bastion.example.com:2200');

    expect(spawn).toHaveBeenCalledWith(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ControlMaster=no',
        '-o',
        'ControlPath=none',
        '-W',
        'target.internal:2202',
        '-p',
        '2200',
        'jumpuser@bastion.example.com',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
  });

  it('destroys socket with stderr details when proxy command exits non-zero', async () => {
    const child = makeMockChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const socket = buildProxyJumpSocket('target.internal', 22, 'bastion');
    const errorPromise = new Promise<Error>((resolve) => {
      socket.once('error', (error) => resolve(error as Error));
    });

    child.stderr.write('Permission denied (publickey)\n');
    child.emit('exit', 255, null);

    const error = await errorPromise;
    expect(error.message).toContain('ProxyJump command failed (exit code 255)');
    expect(error.message).toContain('Permission denied (publickey)');
  });

  it('passes earlier hops via -J and uses the final hop as the destination', () => {
    const child = makeMockChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    buildProxyJumpSocket(
      'target.internal',
      22,
      'alice@hop1.example.com:2201, hop2.example.com , bob@hop3.example.com:2203'
    );

    expect(spawn).toHaveBeenCalledWith(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ControlMaster=no',
        '-o',
        'ControlPath=none',
        '-J',
        'alice@hop1.example.com:2201,hop2.example.com',
        '-W',
        'target.internal:22',
        '-p',
        '2203',
        'bob@hop3.example.com',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
  });

  it('reports "unknown exit" when child exits with neither code nor signal', async () => {
    const child = makeMockChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const socket = buildProxyJumpSocket('target.internal', 22, 'bastion');
    const errorPromise = new Promise<Error>((resolve) => {
      socket.once('error', (error) => resolve(error as Error));
    });

    child.emit('exit', null, null);

    const error = await errorPromise;
    expect(error.message).toContain('ProxyJump command failed (unknown exit)');
    expect(error.message).not.toContain('null');
  });

  it('forwards stderr lines through onStderrLine callback', () => {
    const child = makeMockChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const stderrLines: string[] = [];

    buildProxyJumpSocket('target.internal', 22, 'bastion', {
      onStderrLine: (line) => stderrLines.push(line),
    });

    child.stderr.write('first line\nsecond line\n');
    expect(stderrLines).toEqual(['first line', 'second line']);
  });
});
