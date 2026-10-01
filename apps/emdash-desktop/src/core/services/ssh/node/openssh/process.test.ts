import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runProcess, openProcessStream } from './process';

const invocation = (source: string) => ({
  executable: process.execPath,
  args: ['-e', source],
  env: process.env,
});

describe('owned subprocess operations', () => {
  it('collects both streams and preserves a nonzero remote result', async () => {
    await expect(
      runProcess(
        invocation("process.stdout.write('out');process.stderr.write('err');process.exitCode=7")
      )
    ).resolves.toEqual({ stdout: 'out', stderr: 'err', exitCode: 7 });
  });
  it('preserves multibyte output across chunk boundaries', async () => {
    const result = await runProcess(
      invocation(
        "const b=Buffer.from('你好');process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.end(b.subarray(1)),10)"
      )
    );
    expect(result.stdout).toBe('你好');
  });
  it.each(['stdout', 'stderr'] as const)('bounds %s', async (stream) => {
    await expect(
      runProcess(invocation(`process.${stream}.write('x'.repeat(8192));setInterval(()=>{},1000)`), {
        maxStdoutBytes: 64,
        maxStderrBytes: 64,
      })
    ).rejects.toThrow('limit');
  });
  it('bounds command duration', async () => {
    await expect(
      runProcess(invocation('setInterval(()=>{},1000)'), { timeoutMs: 50 })
    ).rejects.toThrow('timed out');
  });
  it('cancels a running command', async () => {
    const abort = new AbortController();
    const pending = runProcess(invocation('setInterval(()=>{},1000)'), { signal: abort.signal });
    const check = expect(pending).rejects.toThrow('cancelled');
    abort.abort(new Error('cancelled'));
    await check;
  });
  it('rejects before spawning when already cancelled', async () => {
    await expect(
      runProcess(
        { executable: '/missing', args: [], env: {} },
        { signal: AbortSignal.abort(new Error('cancelled')) }
      )
    ).rejects.toThrow('cancelled');
  });
  it('reports a missing executable', async () => {
    await expect(
      runProcess({ executable: '/emdash-missing-ssh', args: [], env: {} })
    ).rejects.toThrow('ENOENT');
  });
  it('waits for an explicit handshake and leaves adjacent binary data intact', async () => {
    const stream = await openProcessStream(
      invocation(
        "process.stdout.write('rea');setTimeout(()=>{process.stdout.write(Buffer.concat([Buffer.from('dy\\n'),Buffer.from([0,255,13,10])]));process.stdin.pipe(process.stdout)},10)"
      ),
      { readyLine: 'ready\n' }
    );
    try {
      const data = once(stream, 'data');
      stream.resume();
      expect((await data)[0]).toEqual(Buffer.from([0, 255, 13, 10]));
      const echo = once(stream, 'data');
      stream.write('hello');
      expect((await echo)[0].toString()).toBe('hello');
    } finally {
      stream.destroy();
    }
  });
  it('rejects a failed handshake with stderr diagnostics', async () => {
    await expect(
      openProcessStream(
        invocation("process.stderr.write('Permission denied');process.exitCode=255"),
        { readyLine: 'ready\n' }
      )
    ).rejects.toThrow('Permission denied');
  });
  it('bounds a missing handshake', async () => {
    await expect(
      openProcessStream(invocation('setInterval(()=>{},1000)'), {
        readyLine: 'ready\n',
        timeoutMs: 50,
      })
    ).rejects.toThrow('timed out');
  });
  it('destroys a returned stream when its owner is cancelled', async () => {
    const owner = new AbortController();
    const stream = await openProcessStream(
      invocation("process.stdout.write('ready\\n');process.stdin.pipe(process.stdout)"),
      { readyLine: 'ready\n', signal: owner.signal }
    );
    const error = once(stream, 'error');
    owner.abort(new Error('connection replaced'));
    expect((await error)[0].message).toBe('connection replaced');
    expect(stream.destroyed).toBe(true);
  });
  it('rejects noisy or malformed handshakes instead of feeding them to Wire', async () => {
    await expect(
      openProcessStream(invocation("process.stdout.write('login banner\\nready\\n')"), {
        readyLine: 'ready\n',
      })
    ).rejects.toThrow('handshake');
  });
});

it.skipIf(process.platform !== 'linux')(
  'kills a stubborn proxy descendant after the SSH parent exits',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'emdash-process-tree-'));
    const pidFile = join(directory, 'pid');
    let descendant: number | undefined;
    const abort = new AbortController();
    const childSource =
      "process.on('SIGTERM',()=>{}); require('node:fs').writeFileSync(process.argv[1],String(process.pid)); setInterval(()=>{},1000)";
    const pending = runProcess(
      invocation(`
    const { spawn } = require('node:child_process');
    spawn(process.execPath, ['-e', ${JSON.stringify(childSource)}, ${JSON.stringify(pidFile)}], { stdio: 'ignore' });
    setInterval(()=>{},1000);
  `),
      { signal: abort.signal }
    );
    const rejected = expect(pending).rejects.toThrow('cancelled');
    try {
      await vi.waitFor(async () => {
        descendant = Number(await readFile(pidFile, 'utf8'));
      });
      abort.abort(new Error('cancelled'));
      await rejected;
      await vi.waitFor(
        async () => {
          const state = await readFile(`/proc/${descendant}/stat`, 'utf8').catch(() => 'gone');
          expect(state === 'gone' || state.split(' ')[2] === 'Z').toBe(true);
        },
        { timeout: 2000 }
      );
    } finally {
      abort.abort(new Error('cancelled'));
      if (descendant) {
        try {
          process.kill(descendant, 'SIGKILL');
        } catch {}
      }
      await rm(directory, { recursive: true, force: true });
    }
  }
);
