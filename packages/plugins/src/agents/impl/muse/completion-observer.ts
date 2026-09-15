import { spawn } from 'node:child_process';
import { readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

// Standalone host helper: keep imports limited to Node builtins.
const POLL_INTERVAL_MS = 200;
const HEALTH_INTERVAL_MS = 5_000;
const REPORT_TIMEOUT_MS = 3_000;
const SESSION_FILE_TIMEOUT_MS = 5_000;
const READ_BUFFER_BYTES = 64 * 1024;
const OBSERVER_TIMEOUT_MS = 24 * 60 * 60 * 1_000;
const MAX_PENDING_LENGTH = 16 * 1024 * 1024;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function parseRecord(source: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(source));
  } catch {
    return undefined;
  }
}

const port = process.env.EMDASH_HOOK_PORT;
const nonce = process.env.EMDASH_HOOK_NONCE;
const conversation = process.env.EMDASH_PTY_ID;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!port || !nonce || !conversation) process.exit(0);
const report = async (type: string, body: Record<string, unknown>): Promise<void> => {
  const response = await fetch('http://127.0.0.1:' + port + '/hook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emdash-Token': nonce,
      'X-Emdash-Pty-Id': conversation,
      'X-Emdash-Event-Type': type,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('Hook server rejected event');
};

if (process.argv[2] !== 'observe') {
  const body = parseRecord(readFileSync(0, 'utf8'));
  if (!body) process.exit(0);
  await report('start', body);
  if (typeof body.session_id !== 'string' || typeof body.turn_id !== 'string') process.exit(0);
  if (!uuid.test(body.session_id) || !uuid.test(body.turn_id)) process.exit(0);
  // Muse session ids are UUIDv7; their timestamp identifies the creation-day directory.
  const [timestampHigh, timestampLow, versionAndRandom] = body.session_id.split('-');
  if (!versionAndRandom.startsWith('7')) process.exit(0);
  const date = new Date(parseInt(timestampHigh + timestampLow, 16));
  const [day] = date.toISOString().split('T');
  const root = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  const file = path.join(
    root,
    'muse',
    'sessions',
    ...day.split('-'),
    body.session_id,
    'session.jsonl'
  );
  let offset = 0;
  try {
    offset = statSync(file).size;
  } catch {}
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'observe'], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      EMDASH_OBSERVER_INPUT: JSON.stringify({
        file,
        offset,
        session: body.session_id,
        turn: body.turn_id,
      }),
    },
  });
  child.on('error', () => {});
  child.unref();
} else {
  const input = parseRecord(process.env.EMDASH_OBSERVER_INPUT ?? '');
  if (
    !input ||
    typeof input.file !== 'string' ||
    typeof input.offset !== 'number' ||
    !Number.isSafeInteger(input.offset) ||
    input.offset < 0 ||
    typeof input.session !== 'string' ||
    typeof input.turn !== 'string'
  )
    process.exit(0);
  let offset = input.offset;
  let pending = '';
  const decoder = new StringDecoder('utf8');
  const deadline = Date.now() + OBSERVER_TIMEOUT_MS;
  let lastHealth = 0;
  const fileDeadline = Date.now() + SESSION_FILE_TIMEOUT_MS;
  let foundFile = false;
  while (Date.now() < deadline) {
    let fd: number | undefined;
    try {
      fd = openSync(input.file, 'r');
      foundFile = true;
      const chunk = Buffer.alloc(READ_BUFFER_BYTES);
      let count: number;
      while ((count = readSync(fd, chunk, 0, chunk.length, offset)) > 0) {
        offset += count;
        pending += decoder.write(chunk.subarray(0, count));
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          const record = parseRecord(line);
          const stream = asRecord(record?.stream);
          const payload = asRecord(record?.payload);
          if (
            stream?.kind !== 'session' ||
            stream.id !== input.session ||
            record?.payload_type !== 'runtime.session' ||
            payload?.kind !== 'run'
          )
            continue;
          const turn = payload.run_id;
          const event = asRecord(payload.event);
          // A newer top-level turn supersedes this observer; never complete its status.
          if (event?.kind === 'started' && turn !== input.turn) process.exit(0);
          if (turn !== input.turn || event?.kind !== 'terminal') continue;
          if (
            event.terminal !== 'completed' &&
            event.terminal !== 'failed' &&
            event.terminal !== 'cancelled'
          )
            continue;
          await report(event.terminal === 'failed' ? 'error' : 'stop', {
            session_id: input.session,
            turn_id: input.turn,
          });
          process.exit(0);
        }
        if (pending.length > MAX_PENDING_LENGTH) process.exit(0);
      }
    } catch (error) {
      if (asRecord(error)?.code !== 'ENOENT' || (!foundFile && Date.now() > fileDeadline))
        process.exit(0);
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    if (Date.now() - lastHealth > HEALTH_INTERVAL_MS) {
      // An ignored event verifies the authenticated server without changing session state.
      try {
        await report('muse-observer-health', {});
      } catch {
        process.exit(0);
      }
      lastHealth = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
