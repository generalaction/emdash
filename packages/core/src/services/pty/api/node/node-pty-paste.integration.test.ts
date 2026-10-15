import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PtySession } from '#services/pty/api';
import { NodePtySpawner } from './node-pty-spawner';

// Writes converted clipboard pastes through the production PTY path (PtySession ->
// NodePtySpawner -> node-pty) into a child that reads its terminal in raw mode, then compares
// the exact bytes the child received. Payloads have the shape the renderer sends after
// terminal.paste(): line breaks are CR, embedded ESC is already shown as U+241B, and
// bracketed-paste markers are present only when the destination negotiated them. The probe
// negotiates mode 2004 like a real destination; Node's raw mode uses VT input on Windows, so
// ConPTY is expected to pass the frame through unchanged.

const BEGIN = '\x1b[200~';
const END = '\x1b[201~';
// Payloads never contain C0 controls other than HT/CR, so EOT can delimit the capture.
const DONE = '\x04';

// The probe writes what it receives as it arrives, so a slow or stalled transport leaves
// evidence of how far it got.
const PROBE = `
const fs = require('node:fs');
const out = fs.openSync(process.argv[2], 'w');
process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => {
  const done = chunk.indexOf(0x04);
  fs.writeSync(out, done === -1 ? chunk : chunk.subarray(0, done));
  if (done === -1) return;
  fs.closeSync(out);
  process.exit(0);
});
process.stdout.write('\\x1b[?2004hPROBE_READY');
`;

// Test deadlines only. Delivery must keep making progress: no new bytes for STALL_MS means
// the transport stalled or lost the rest. Windows ConPTY moves paste input at tens of
// kilobytes per second, so a whole case gets its own, larger bound.
const READY_DEADLINE_MS = 15_000;
const STALL_MS = 10_000;
const CASE_DEADLINE_MS = 180_000;
const EXIT_AFTER_KILL_MS = 10_000;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

function deadline<T>(promise: Promise<T>, ms: number, describe: () => string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${describe()} after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function fileSize(path: string): Promise<number> {
  return stat(path).then(
    (info) => info.size,
    () => 0
  );
}

function firstDifference(received: Buffer, expected: Buffer): number | null {
  const length = Math.min(received.byteLength, expected.byteLength);
  for (let offset = 0; offset < length; offset++) {
    if (received[offset] !== expected[offset]) return offset;
  }
  return received.byteLength === expected.byteLength ? null : length;
}

function lines(length: number): string {
  const body = 'abcdefghijklmnopqrstuvwxyz0123456789_'.repeat(Math.ceil(length / 37) + 1);
  return body.replace(/.{79}/g, '$&\n').slice(0, length - 8) + 'END_MARK';
}

function line(length: number): string {
  return 'x'.repeat(length - 8) + 'END_MARK';
}

/** The renderer's paste conversion: CR line breaks, then negotiated framing. */
function converted(text: string, bracketed = true): string {
  const normalized = text.replace(/\r?\n/g, '\r');
  return bracketed ? BEGIN + normalized + END : normalized;
}

// A four-byte character straddling a byte boundary of the framed payload.
function straddling(boundary: number): string {
  const prefix = 'y'.repeat(boundary - Buffer.byteLength(BEGIN) - 2);
  return `${prefix}🙂${'z'.repeat(64)}`;
}

const cases: [name: string, writes: string[]][] = [
  ...[1399, 1400, 1401].map((n): [string, string[]] => [
    `${n}-character line`,
    [converted(line(n))],
  ]),
  ...[1399, 1400, 1401].map((n): [string, string[]] => [
    `${n}-character multiline paste`,
    [converted(lines(n))],
  ]),
  ['CRLF clipboard text', [converted('first\r\nsecond\r\nthird\r\n')]],
  ['whitespace and Unicode', [converted('\t  indented  \n\né é 中文 🙂 👩‍💻 العربية')]],
  ['UTF-8 across 1,024 bytes', [converted(straddling(1024))]],
  ['UTF-8 across 4,096 bytes', [converted(straddling(4096))]],
  ['64 KiB multiline paste', [converted(lines(64 * 1024))]],
  ['1 MiB multiline paste', [converted(lines(1024 * 1024))]],
  ['shown embedded markers', [converted('head␛[201~\nbody␛[200~tail')]],
  ['unframed confirmed paste', [converted('echo one\necho two\n', false)]],
  ['two rapid pastes', [converted('first\n'), converted('second\r\n')]],
];

describe('clipboard paste bytes through a native PTY', () => {
  let dir: string;
  let probe: string;
  // Probes that were still running EXIT_AFTER_KILL_MS after their case killed them.
  const survivors: string[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'emdash-pty-paste-'));
    probe = join(dir, 'probe.cjs');
    await writeFile(probe, PROBE);
    if (process.platform === 'darwin') {
      // node-pty spawns through spawn-helper next to its native module; its npm tarball
      // ships the macOS prebuild without the executable bit, which the desktop postinstall
      // restores. Without it every spawn fails with "posix_spawnp failed".
      const require = createRequire(import.meta.url);
      const lib = dirname(require.resolve('node-pty'));
      const { loadNativeModule } = require('node-pty/lib/utils') as {
        loadNativeModule(name: string): { dir: string };
      };
      const helper = resolve(lib, loadNativeModule('pty').dir, 'spawn-helper');
      await expect(access(helper, constants.X_OK), `${helper} is executable`).resolves.toBe(
        undefined
      );
    }
  });

  afterAll(async () => {
    // Retries cover Windows releasing file handles shortly after a probe exits.
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    expect(survivors, 'probes still running after their case killed them').toEqual([]);
  });

  async function receive(name: string, writes: string[], index: number): Promise<Buffer> {
    const out = join(dir, `received-${index}.bin`);
    const expected = Buffer.from(writes.join(''), 'utf8');
    const env = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => !!entry[1])
    );
    const spec = {
      invocation: { kind: 'argv' as const, executable: process.execPath, argv: [probe, out] },
      // Not the case directory: a live child's working directory cannot be removed on Windows.
      cwd: tmpdir(),
      env,
      cols: 120,
      rows: 40,
    };
    const pty = await new NodePtySpawner().spawn(spec);
    let output = '';
    let exited: (code: number | null) => void = () => {};
    const exit = new Promise<number | null>((done) => (exited = done));
    let ready: () => void = () => {};
    const isReady = new Promise<void>((done) => (ready = done));
    const session = new PtySession(`paste-${index}`, spec, pty, {
      onData: (chunk) => {
        output += chunk;
        if (output.includes('PROBE_READY')) ready();
      },
      onExit: (info) => exited(info.exitCode),
    });
    const tail = () => JSON.stringify(output.slice(-200));
    let started = Date.now();
    let progressedAt = started;
    const progress = async (problem: string) => {
      const received = await readFile(out).catch(() => Buffer.alloc(0));
      const active = progressedAt - started;
      const difference = firstDifference(received, expected);
      return (
        `${problem}: received ${received.byteLength} of ${expected.byteLength} bytes, the ` +
        `last after ${active} ms (${Math.round((received.byteLength * 1000) / Math.max(active, 1))} ` +
        `B/s), waited ${Date.now() - started} ms; first difference at ${difference ?? 'none'}; ` +
        `sha256 ${sha256(received)}; terminal output ${tail()}`
      );
    };
    try {
      // Raw mode must be active before input arrives, or the line discipline edits it.
      await deadline(isReady, READY_DEADLINE_MS, () => `probe not ready; output ${tail()}`);
      started = Date.now();
      progressedAt = started;
      for (const data of writes) expect(session.write(data)).toBe(true);
      expect(session.write(DONE)).toBe(true);

      let size = 0;
      const exitCode = exit.then((code) => ({ code }));
      for (;;) {
        const settled = await Promise.race([exitCode, sleep(250).then(() => null)]);
        if (settled) {
          expect(settled.code, await progress('probe exit')).toBe(0);
          break;
        }
        const now = Date.now();
        const current = await fileSize(out);
        if (current > size) {
          size = current;
          progressedAt = now;
        }
        if (now - progressedAt > STALL_MS) throw new Error(await progress('delivery stalled'));
        if (now - started > CASE_DEADLINE_MS) throw new Error(await progress('delivery too slow'));
      }
      const received = await readFile(out);
      const ms = Date.now() - started;
      console.log(
        `[pty paste] ${name}: ${received.byteLength} bytes in ${ms} ms on ${process.platform}`
      );
      return received;
    } finally {
      // Kill the probe if it is still running and wait for it to exit; one that does not is
      // reported when the suite ends.
      session.dispose();
      const stopped = await Promise.race([
        exit.then(() => true),
        sleep(EXIT_AFTER_KILL_MS).then(() => false),
      ]);
      if (!stopped) {
        survivors.push(
          `${name} (pid ${pty.getPid?.()}) still running ${EXIT_AFTER_KILL_MS} ms after kill`
        );
      }
    }
  }

  it.each(cases.map(([name, writes], index) => ({ name, writes, index })))(
    'delivers $name byte for byte',
    async ({ name, writes, index }) => {
      const received = await receive(name, writes, index);
      const expected = Buffer.from(writes.join(''), 'utf8');
      expect(received.byteLength).toBe(expected.byteLength);
      expect(sha256(received)).toBe(sha256(expected));
      expect(received.equals(expected)).toBe(true);
    },
    READY_DEADLINE_MS + CASE_DEADLINE_MS + EXIT_AFTER_KILL_MS + 10_000
  );
});

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
