import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const PROBE = `
const fs = require('node:fs');
const chunks = [];
process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => {
  const done = chunk.indexOf(0x04);
  chunks.push(done === -1 ? chunk : chunk.subarray(0, done));
  if (done === -1) return;
  fs.writeFileSync(process.argv[2], Buffer.concat(chunks));
  process.exit(0);
});
process.stdout.write('\\x1b[?2004hPROBE_READY');
`;

// Test deadlines only: a broken transport fails its case instead of hanging the suite.
const READY_DEADLINE_MS = 15_000;
const EXIT_DEADLINE_MS = 30_000;

// After one case misses a deadline the remaining cases fail at once with the same cause.
let transportFailure: Error | null = null;

function deadline<T>(promise: Promise<T>, ms: number, describe: () => string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        transportFailure = new Error(`${describe()} after ${ms} ms`);
        reject(transportFailure);
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
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

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'emdash-pty-paste-'));
    probe = join(dir, 'probe.cjs');
    await writeFile(probe, PROBE);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function receive(writes: string[], index: number): Promise<Buffer> {
    if (transportFailure) throw transportFailure;
    const out = join(dir, `received-${index}.bin`);
    const env = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => !!entry[1])
    );
    const spec = {
      invocation: { kind: 'argv' as const, executable: process.execPath, argv: [probe, out] },
      cwd: dir,
      env,
      cols: 120,
      rows: 40,
    };
    const pty = await new NodePtySpawner().spawn(spec);
    let output = '';
    let exited: (code: number | null) => void = () => {};
    const exit = new Promise<number | null>((resolve) => (exited = resolve));
    let ready: () => void = () => {};
    const isReady = new Promise<void>((resolve) => (ready = resolve));
    const session = new PtySession(`paste-${index}`, spec, pty, {
      onData: (chunk) => {
        output += chunk;
        if (output.includes('PROBE_READY')) ready();
      },
      onExit: (info) => exited(info.exitCode),
    });
    const tail = () => JSON.stringify(output.slice(-200));
    try {
      // Raw mode must be active before input arrives, or the line discipline edits it.
      await deadline(isReady, READY_DEADLINE_MS, () => `probe not ready; output ${tail()}`);
      for (const data of writes) expect(session.write(data)).toBe(true);
      expect(session.write(DONE)).toBe(true);
      const code = await deadline(exit, EXIT_DEADLINE_MS, () => `probe did not exit; ${tail()}`);
      expect(code).toBe(0);
      return await readFile(out);
    } finally {
      // Kills the probe if a deadline fired, so no child outlives its case.
      session.dispose();
    }
  }

  it.each(cases.map(([name, writes], index) => ({ name, writes, index })))(
    'delivers $name byte for byte',
    async ({ writes, index }) => {
      const received = await receive(writes, index);
      const expected = Buffer.from(writes.join(''), 'utf8');
      expect(received.byteLength).toBe(expected.byteLength);
      expect(sha256(received)).toBe(sha256(expected));
      expect(received.equals(expected)).toBe(true);
    },
    EXIT_DEADLINE_MS + READY_DEADLINE_MS + 10_000
  );
});

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
