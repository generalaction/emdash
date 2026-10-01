import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitWithSignal } from '@emdash/shared/scheduling';
import type { OpenSshConfig } from '../connect/resolve-ssh-connect-config';
import { sshKeyFingerprint } from '../credentials/credential-identity';

export type AskpassOptions = {
  signal?: AbortSignal;
  readKey?: (path: string) => Promise<string>;
  confirmHost?: (prompt: string) => Promise<boolean>;
};

/** Match the destination/key before disclosure; a jump host must never receive the target password. */
export async function answerPrompt(
  config: OpenSshConfig,
  prompt: string,
  hint: string,
  options: AskpassOptions
): Promise<string | null> {
  options.signal?.throwIfAborted();
  const hostConfirmation =
    prompt.startsWith('The authenticity of host ') &&
    /Are you sure you want to continue connecting \(yes\/no(?:\/\[fingerprint\])?\)\?\s*$/.test(
      prompt
    );
  if (hint === 'confirm' || hostConfirmation) {
    if (!options.confirmHost) return null;
    const confirmation = options.confirmHost(prompt);
    const accepted = await (options.signal
      ? waitWithSignal(confirmation, options.signal)
      : confirmation);
    options.signal?.throwIfAborted();
    return accepted ? 'yes' : null;
  }
  if (hint) return null;
  const text = prompt.trim();
  if (text === `${config.username}@${config.hostname}'s password:`)
    return config.password?.expose() ?? null;
  if (
    config.keyPath &&
    config.keyFingerprint &&
    text === `Enter passphrase for key '${config.keyPath}':`
  ) {
    const contents = await (options.readKey ?? ((path: string) => readFile(path, 'utf8')))(
      config.keyPath
    ).catch(() => undefined);
    options.signal?.throwIfAborted();
    if (
      contents === undefined ||
      sshKeyFingerprint(config.keyPath, contents) !== config.keyFingerprint
    )
      return null;
    return config.passphrase?.expose() ?? null;
  }
  return null;
}

const HELPER_SOURCE = `
const response = await fetch(process.env.EMDASH_SSH_ASKPASS_ENDPOINT, {
  method: 'POST',
  body: JSON.stringify({ token: process.env.EMDASH_SSH_ASKPASS_TOKEN, prompt: process.argv[2] || '', hint: process.env.SSH_ASKPASS_PROMPT || '' }),
  signal: AbortSignal.timeout(120000),
}).catch(() => null);
if (!response?.ok) process.exitCode = 1;
else process.stdout.write((await response.text()) + '\\n');
`;

/** Ephemeral, capability-protected broker. No credential is stored in files, argv or the environment. */
export async function createAskpass(config: OpenSshConfig, options: AskpassOptions = {}) {
  options.signal?.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), 'emdash-askpass-'));
  const token = randomBytes(32).toString('hex');
  const lifetime = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, lifetime.signal])
    : lifetime.signal;
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const reject = (status: number) => {
      response.writeHead(status);
      response.end();
    };
    if (request.method !== 'POST' || signal.aborted) {
      reject(403);
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
      if (Buffer.byteLength(body) > 8192) request.destroy();
    });
    request.on('error', () => {});
    request.on('end', () => {
      void (async () => {
        let data: { token?: unknown; prompt?: unknown; hint?: unknown };
        try {
          data = JSON.parse(body);
        } catch {
          reject(400);
          return;
        }
        if (
          !data ||
          typeof data.token !== 'string' ||
          Buffer.byteLength(data.token) !== Buffer.byteLength(token) ||
          !timingSafeEqual(Buffer.from(data.token), Buffer.from(token))
        ) {
          reject(403);
          return;
        }
        if (
          typeof data.prompt !== 'string' ||
          (data.hint !== undefined && typeof data.hint !== 'string')
        ) {
          reject(400);
          return;
        }
        try {
          const answer = await answerPrompt(config, data.prompt, String(data.hint ?? ''), {
            ...options,
            signal,
          });
          if (answer === null || signal.aborted) {
            reject(403);
            return;
          }
          response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end(answer);
        } catch {
          reject(403);
        }
      })();
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  let disposed: Promise<void> | undefined;
  const dispose = (): Promise<void> =>
    (disposed ??= (async () => {
      lifetime.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    })());
  try {
    const helper = join(directory, 'helper.mjs');
    const launcher = join(directory, process.platform === 'win32' ? 'askpass.cmd' : 'askpass');
    await writeFile(helper, HELPER_SOURCE, { mode: 0o600 });
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const script =
      process.platform === 'win32'
        ? `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${helper}" %*\r\n`
        : `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${quote(process.execPath)} ${quote(helper)} "$@"\n`;
    await writeFile(launcher, script, { mode: 0o700 });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Could not start SSH credential broker');
    signal.throwIfAborted();
    return {
      env: {
        SSH_ASKPASS: launcher,
        SSH_ASKPASS_REQUIRE: 'force',
        DISPLAY: config.env.DISPLAY || ':0',
        EMDASH_SSH_ASKPASS_ENDPOINT: `http://127.0.0.1:${address.port}/`,
        EMDASH_SSH_ASKPASS_TOKEN: token,
        LC_ALL: 'C',
      },
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
