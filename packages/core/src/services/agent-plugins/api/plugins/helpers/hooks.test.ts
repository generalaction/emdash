import { Buffer } from 'node:buffer';
import { execFile, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  EMDASH_MARKER,
  EMDASH_HOOK_VERSION_MARKER,
  filterUserHooks,
  makeNotificationHookCommand,
  makeStdinHookCommand,
  makeWindowsPowerShellHookCommand,
} from './hooks';

describe('hook command helpers', () => {
  it('builds POSIX stdin hook commands', () => {
    expect(makeStdinHookCommand('stop', { platform: 'linux' })).toBe(
      `${EMDASH_HOOK_VERSION_MARKER}; ` +
        'if [ -z "${EMDASH_HOOK_PORT:-}" ] || [ -z "${EMDASH_HOOK_NONCE:-}" ] || [ -z "${EMDASH_PTY_ID:-}" ]; then exit 0; fi; ' +
        '{ printf "header = \\"X-Emdash-Token: %s\\"\\n" "$EMDASH_HOOK_NONCE" | ' +
        '{ curl -q --noproxy "*" -K /dev/fd/3 -sf -X POST ' +
        '-H "Content-Type: application/json" ' +
        '-H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" ' +
        '-H "X-Emdash-Event-Type: stop" ' +
        '-d @- ' +
        '"http://127.0.0.1:$EMDASH_HOOK_PORT/hook" 3<&0 0<&4 4<&-; }; } 4<&0 || true'
    );
  });

  it.skipIf(process.platform === 'win32')(
    'does not invoke curl when the Emdash hook environment is absent',
    () => {
      const command = makeStdinHookCommand('stop', { platform: 'linux' });
      const shellCommand = `curl() { printf called; }; ${command}`;

      const outsideEmdash = spawnSync('/bin/sh', ['-c', shellCommand], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '' },
        input: '{}',
      });
      const insideEmdash = spawnSync('/bin/sh', ['-c', shellCommand], {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH ?? '',
          EMDASH_HOOK_PORT: '1234',
          EMDASH_HOOK_NONCE: 'nonce',
          EMDASH_PTY_ID: 'pty-1',
        },
        input: '{}',
      });

      expect(outsideEmdash.status).toBe(0);
      expect(outsideEmdash.stdout).toBe('');
      expect(insideEmdash.status).toBe(0);
      expect(insideEmdash.stdout).toBe('called');
    }
  );

  it('builds Windows hook commands as one powershell.exe call every outer shell reads alike', () => {
    const command = makeNotificationHookCommand('idle_prompt', { platform: 'win32' });

    expect(command).toMatch(
      /^powershell\.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand [A-Za-z0-9+/]+=*$/
    );
    // Git Bash rewrites arguments that start with `/` into drive paths.
    expect(command.split(' ').filter((arg) => arg.startsWith('/'))).toEqual([]);
    expect(decodeWindowsHookScript(command)).toContain(
      `$payload = '{"notification_type":"idle_prompt"}'`
    );
  });

  it('emits no redirects (an outer shell parsing >NUL creates a stray NUL file)', () => {
    const command = makeWindowsPowerShellHookCommand('Write-Output "ok"');

    expect(command).not.toContain('>');
  });

  it.skipIf(process.platform === 'win32')(
    'returns safely quoted JSON when transport fails or routing variables are absent',
    () => {
      const response = {
        decision: 'stop',
        reason: "don't run $(printf injected) or `echo injected`",
      };
      const command = makeStdinHookCommand('stop', {
        platform: 'linux',
        stdoutJson: response,
      });
      for (const env of [
        {},
        { EMDASH_HOOK_PORT: '1234', EMDASH_HOOK_NONCE: 'nonce', EMDASH_PTY_ID: 'pty-1' },
      ]) {
        const result = spawnSync(
          '/bin/sh',
          ['-c', `curl() { printf 'unexpected server response'; return 22; }; ${command}`],
          { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env }, input: '{}' }
        );
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual(response);
      }
    }
  );

  it('marks Windows hook scripts so hook config cleanup can find them', () => {
    const command = makeWindowsPowerShellHookCommand('Write-Output "ok"');

    expect(decodeWindowsHookScript(command)).toBe(
      `# ${EMDASH_HOOK_VERSION_MARKER} ${EMDASH_MARKER}\nWrite-Output "ok"`
    );
    expect(filterUserHooks([{ command }])).toEqual([]);
  });

  it('keeps user PowerShell hooks and drops legacy cmd.exe-wrapped Emdash hooks', () => {
    const userEncoded = Buffer.from('Write-Output "mine"', 'utf16le').toString('base64');
    const userHook = { command: `powershell.exe -EncodedCommand ${userEncoded}` };
    const legacyHook = {
      command:
        `cmd.exe /d /c set EMDASH_HOOK_MARKER=${EMDASH_HOOK_VERSION_MARKER} ${EMDASH_MARKER}&&` +
        `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${userEncoded}`,
    };

    expect(filterUserHooks([userHook, legacyHook])).toEqual([userHook]);
  });

  it.skipIf(process.platform === 'win32')(
    'hands the hook payload only to PowerShell when a POSIX shell such as Git Bash runs it',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'emdash-windows-hook-'));
      try {
        // Stand-ins record what each Windows program receives.
        for (const program of ['powershell.exe', 'cmd.exe']) {
          const stub = join(dir, program);
          writeFileSync(
            stub,
            `#!/bin/sh\nprintf '%s\\n' "$@" > "${stub}.argv"\ncat > "${stub}.stdin"\n`
          );
          chmodSync(stub, 0o755);
        }
        // Quotes and cmd.exe operators, as prompt text can carry them.
        const payload = '{"prompt":"a \\"quoted\\" & b | c > d"}';
        const command = makeStdinHookCommand('start', { platform: 'win32' });

        const result = spawnSync('/bin/sh', ['-c', command], {
          cwd: dir,
          encoding: 'utf8',
          env: { PATH: `${dir}:${process.env.PATH ?? ''}` },
          input: payload,
        });

        expect(result.status).toBe(0);
        expect(existsSync(join(dir, 'cmd.exe.argv'))).toBe(false);
        expect(readFileSync(join(dir, 'powershell.exe.stdin'), 'utf8')).toBe(payload);
        expect(
          readFileSync(join(dir, 'powershell.exe.argv'), 'utf8').trimEnd().split('\n')
        ).toEqual(command.split(' ').slice(1));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
});

/** The PowerShell script a Windows hook command carries in `-EncodedCommand`. */
function decodeWindowsHookScript(command: string): string {
  const encoded = command.split(' -EncodedCommand ')[1] ?? '';
  return Buffer.from(encoded, 'base64').toString('utf16le');
}

type RecordedRequest = { url?: string; headers: IncomingMessage['headers']; body: string };

/** A loopback HTTP server that records every request, answering once `beforeResponse` settles. */
async function withRecordingServer(
  run: (port: number, requests: RecordedRequest[]) => Promise<void>,
  beforeResponse: () => Promise<void> = async () => {}
): Promise<void> {
  const requests: RecordedRequest[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      requests.push({ url: request.url, headers: request.headers, body });
      void beforeResponse().finally(() => response.end());
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run((server.address() as AddressInfo).port, requests);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

/** Runs a hook command in `shell` with an isolated home, so only the given curlrc and env apply. */
async function runHookCommand(
  shell: string,
  command: string,
  env: Record<string, string>,
  options: { curlrc?: string } = {}
): Promise<{ status: number | null; stdout: string }> {
  const home = mkdtempSync(join(tmpdir(), 'emdash-hook-home-'));
  try {
    if (options.curlrc !== undefined) writeFileSync(join(home, '.curlrc'), options.curlrc);
    return await new Promise((resolve) => {
      const child = execFile(
        shell,
        ['-c', command],
        {
          cwd: home,
          env: { PATH: process.env.PATH ?? '', HOME: home, CURL_HOME: home, ...env },
          encoding: 'utf8',
          timeout: 10_000,
        },
        (error, stdout) => {
          const status = error ? (typeof error.code === 'number' ? error.code : null) : 0;
          resolve({ status, stdout });
        }
      );
      child.stdin?.end('{"hook_event_name":"Stop"}');
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** Every process's argv as `ps` lists it, which any local user can read. */
async function processArgvs(): Promise<string> {
  const { stdout } = await promisify(execFile)('ps', ['-A', '-ww', '-o', 'args=']);
  return stdout;
}

const hookShells = ['/bin/sh', '/bin/bash', '/bin/dash', '/bin/zsh'].filter((shell) =>
  existsSync(shell)
);

describe.skipIf(process.platform === 'win32')('hook commands with curl', () => {
  const hookEnv = (port: number) => ({
    EMDASH_HOOK_PORT: String(port),
    EMDASH_HOOK_NONCE: 'hook-nonce',
    EMDASH_PTY_ID: 'pty-1',
  });

  it.each(hookShells)(
    'posts straight to the hook server when proxy variables are set (%s)',
    async (shell) => {
      await withRecordingServer(async (proxyPort, proxied) => {
        const proxy = `http://127.0.0.1:${proxyPort}`;
        await withRecordingServer(async (port, requests) => {
          const result = await runHookCommand(
            shell,
            makeStdinHookCommand('stop', { platform: 'linux' }),
            {
              ...hookEnv(port),
              http_proxy: proxy,
              HTTP_PROXY: proxy,
              all_proxy: proxy,
              ALL_PROXY: proxy,
            }
          );
          expect(result.status).toBe(0);
          expect(requests).toEqual([
            expect.objectContaining({
              url: '/hook',
              body: '{"hook_event_name":"Stop"}',
              headers: expect.objectContaining({
                'x-emdash-token': 'hook-nonce',
                'x-emdash-pty-id': 'pty-1',
                'x-emdash-event-type': 'stop',
              }),
            }),
          ]);
        });
        // The proxy never sees the hook request or its nonce.
        expect(proxied).toEqual([]);
      });
    }
  );

  it.each(hookShells)(
    'keeps the nonce out of every process argv while the request is in flight (%s)',
    async (shell) => {
      // Unique, so no unrelated process on the machine can carry it.
      const nonce = randomUUID();
      let argvs = '';
      let hookPort = 0;
      await withRecordingServer(
        async (port, requests) => {
          hookPort = port;
          const result = await runHookCommand(
            shell,
            makeStdinHookCommand('stop', { platform: 'linux' }),
            { ...hookEnv(port), EMDASH_HOOK_NONCE: nonce }
          );
          expect(result.status).toBe(0);
          expect(requests[0]?.headers['x-emdash-token']).toBe(nonce);
        },
        async () => {
          argvs = await processArgvs();
        }
      );
      // The listing caught curl mid-request, without its nonce.
      const curl = argvs.split('\n').find((argv) => argv.includes(`127.0.0.1:${hookPort}/`));
      expect(curl).toMatch(/^curl -q --noproxy \* -K \/dev\/fd\/3 /);
      expect(argvs).not.toContain(nonce);
    }
  );

  it('ignores curlrc options that would reroute the request or print to the agent', async () => {
    await withRecordingServer(async (proxyPort, proxied) => {
      await withRecordingServer(async (port, requests) => {
        const result = await runHookCommand(
          '/bin/sh',
          makeNotificationHookCommand('idle_prompt', { platform: 'linux' }),
          hookEnv(port),
          // `include` would print response headers into the hook's stdout.
          { curlrc: `proxy = "http://127.0.0.1:${proxyPort}"\ninclude\n` }
        );
        expect(result).toEqual({ status: 0, stdout: '' });
        expect(requests.map((request) => request.body)).toEqual([
          '{"notification_type":"idle_prompt"}',
        ]);
      });
      expect(proxied).toEqual([]);
    });
  });
});
