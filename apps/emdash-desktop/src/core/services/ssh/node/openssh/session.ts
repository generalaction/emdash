import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import type {
  SshExecOptions,
  SshExecResult,
  SshPortForward,
  SshForwardOptions,
} from '@core/primitives/ssh/api/node/ssh-client-proxy';
import type { OpenSshConfig } from '../connect/resolve-ssh-connect-config';
import { createAskpass, type AskpassOptions } from './askpass';
import { openProcessStream, runProcess, type ProcessInvocation } from './process';

export interface SshSession {
  readonly closed: Promise<Error | undefined>;
  exec(command: string, options?: SshExecOptions): Promise<SshExecResult>;
  openStream(
    command: string,
    options?: { signal?: AbortSignal; timeoutMs?: number }
  ): Promise<Duplex>;
  forwardPort(remotePort: number, options?: SshForwardOptions): Promise<SshPortForward>;
  close(): Promise<void>;
}

/** One physical connection generation. This module owns processes; it never retries a connection. */
export async function connectOpenSsh(
  config: OpenSshConfig,
  options: AskpassOptions & { multiplex?: boolean } = {}
): Promise<SshSession> {
  const lifetime = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, lifetime.signal])
    : lifetime.signal;
  const askpass = await createAskpass(config, { ...options, signal });
  let primary: Duplex | undefined;
  let sessionArgs: string[] = [];
  let controlDirectory: string | undefined;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      lifetime.abort(new Error('SSH connection closed'));
      primary?.destroy();
      await askpass.dispose();
      if (controlDirectory) await rm(controlDirectory, { recursive: true, force: true });
    })());
  const operationSignal = (caller?: AbortSignal) =>
    caller ? AbortSignal.any([signal, caller]) : signal;
  const invocation = (
    command: string,
    extraArgs: string[] = [],
    multiplex = true
  ): ProcessInvocation => ({
    executable: config.executable ?? 'ssh',
    args: [
      ...extraArgs,
      ...sessionArgs,
      ...(multiplex && controlDirectory ? ['-S', join(controlDirectory, 'c')] : []),
      '-o',
      'ControlPersist=no',
      ...config.args,
      '--',
      config.destination,
      command,
    ],
    env: { ...config.env, ...askpass.env },
  });
  const open = async (
    command: string,
    streamOptions: { signal?: AbortSignal; timeoutMs?: number } = {},
    extraArgs: string[] = [],
    multiplex = true
  ) => {
    const readyLine = `EMDASH_READY_${randomUUID()}\n`;
    return openProcessStream(
      invocation(`printf '%s\\n' '${readyLine.trim()}'; ${command}`, extraArgs, multiplex),
      {
        signal: operationSignal(streamOptions.signal),
        readyLine,
        timeoutMs: streamOptions.timeoutMs ?? config.readyTimeout,
      }
    );
  };
  try {
    sessionArgs = await nativeSessionArgs(config, signal);
    if (options.multiplex ?? process.platform !== 'win32') {
      // Keep the path below the Unix socket length limit, including on macOS's long TMPDIR.
      const base = tmpdir().length < 60 ? tmpdir() : '/tmp';
      controlDirectory = await mkdtemp(join(base, 'emdash-ssh-'));
    }
    primary = await open('cat >/dev/null', {}, [
      '-o',
      'ClearAllForwardings=yes',
      ...(controlDirectory ? ['-M'] : []),
    ]);
    primary.resume();
    const closed = observeStream(primary);
    // The manager also observes closure and reports cleanup failures through retire().
    void closed.then(() => close()).catch(() => {});
    const session: SshSession = {
      closed,
      close,
      async exec(command, execOptions = {}) {
        const marker = `EMDASH_EXIT_${randomUUID()}:`;
        // A remote exit of 255 is valid. The footer distinguishes it from an SSH transport error.
        const wrapped = `(\n${command}\n)\n_emdash_status=$?\nprintf '\\n${marker}%s\\n' "$_emdash_status" >&2\nexit "$_emdash_status"`;
        const stderrLimit = execOptions.maxStderrBytes ?? 1024 * 1024;
        const result = await runProcess(invocation(wrapped, ['-o', 'ClearAllForwardings=yes']), {
          ...execOptions,
          signal: operationSignal(execOptions.signal),
          maxStderrBytes: stderrLimit + marker.length + 8,
        });
        const match = result.stderr.match(new RegExp(`\\n${marker}(\\d+)\\n$`));
        if (!match)
          throw new Error(
            result.stderr.trim() || 'SSH command ended without an exit acknowledgement'
          );
        const stderr = result.stderr.slice(0, match.index);
        if (Buffer.byteLength(stderr) > stderrLimit)
          throw new Error(`SSH command stderr exceeded the ${stderrLimit}-byte limit`);
        return { ...result, stderr, exitCode: Number(match[1]) };
      },
      openStream: (command, streamOptions) =>
        open(command, streamOptions, ['-o', 'ClearAllForwardings=yes']),
      async forwardPort(remotePort, forwardOptions = {}) {
        if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535)
          throw new Error('Invalid remote port');
        if (
          forwardOptions.preferredLocalPort !== undefined &&
          (!Number.isInteger(forwardOptions.preferredLocalPort) ||
            forwardOptions.preferredLocalPort < 1 ||
            forwardOptions.preferredLocalPort > 65535)
        )
          throw new Error('Invalid local port');
        const owner = operationSignal(forwardOptions.signal);
        // Binding is the only retry here: another process may claim the port between reserve and ssh.
        for (let attempt = 0; attempt < 3; attempt++) {
          owner.throwIfAborted();
          const localPort =
            attempt === 0 && forwardOptions.preferredLocalPort
              ? forwardOptions.preferredLocalPort
              : await availablePort();
          try {
            // A forward owns its own process, so closing it also removes its listener.
            // sshd resolves localhost and tries both address families on each incoming connection.
            const stream = await open(
              'cat >/dev/null',
              { signal: owner, timeoutMs: forwardOptions.timeoutMs },
              [
                '-o',
                'ExitOnForwardFailure=yes',
                '-L',
                `127.0.0.1:${localPort}:localhost:${remotePort}`,
              ],
              false
            );
            stream.resume();
            const ended = observeStream(stream);
            return {
              localPort,
              closed: ended,
              close: async () => {
                stream.destroy();
                await ended;
              },
            };
          } catch (error) {
            owner.throwIfAborted();
            if (
              attempt === 2 ||
              !(error instanceof Error) ||
              !/address already in use|cannot listen to port/i.test(error.message)
            )
              throw error;
          }
        }
        throw new Error('Could not allocate a local SSH forwarding port');
      },
    };
    return session;
  } catch (error) {
    await close();
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'OpenSSH client was not found. Install OpenSSH and make ssh available to Emdash.',
        { cause: error }
      );
    }
    throw error;
  }
}

async function nativeSessionArgs(config: OpenSshConfig, signal: AbortSignal): Promise<string[]> {
  const version = await runProcess(
    { executable: config.executable ?? 'ssh', args: ['-V'], env: config.env },
    { signal, timeoutMs: 5_000, maxStdoutBytes: 4096, maxStderrBytes: 4096 }
  );
  const match = `${version.stdout}\n${version.stderr}`.match(
    /OpenSSH(?:_for_Windows)?_(\d+)\.(\d+)/
  );
  if (version.exitCode !== 0 || !match)
    throw new Error('Invalid SSH client: OpenSSH version could not be identified');
  // These config equivalents of -f/-n/-N were introduced together in OpenSSH 8.7.
  // Older clients cannot enable them in config, so simply omitting the flags is sufficient.
  const modern = Number(match[1]) > 8 || (Number(match[1]) === 8 && Number(match[2]) >= 7);
  return modern
    ? ['-o', 'ForkAfterAuthentication=no', '-o', 'StdinNull=no', '-o', 'SessionType=default']
    : [];
}

function observeStream(stream: Duplex): Promise<Error | undefined> {
  return new Promise((resolve) => {
    let failure: Error | undefined;
    stream.once('error', (error) => {
      failure = error;
    });
    stream.once('close', () => resolve(failure));
    if (stream.destroyed) resolve(failure);
  });
}

async function availablePort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const address = listener.address();
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  if (!address || typeof address === 'string')
    throw new Error('Could not allocate a local forwarding port');
  return address.port;
}
