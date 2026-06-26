import { StringDecoder } from 'node:string_decoder';
import { IGNORED_PATH_SEGMENTS } from '@emdash/core/files';
import type { ClientChannel } from 'ssh2';
import { buildRemoteShellCommand } from '@main/core/ssh/lifecycle/remote-shell-profile';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { quoteShellArg } from '@main/utils/shellEscape';
import { isIgnoredRemotePath, toRemoteAbsolutePath } from './ssh-paths';

export async function* enumerateRemoteWorkspace(
  proxy: SshClientProxy,
  rootPath: string
): AsyncIterable<string> {
  for await (const rawPath of execRemoteNulFields(proxy, buildRemoteEnumerationCommand(rootPath))) {
    const absPath = toRemoteAbsolutePath(rootPath, rawPath);
    if (isIgnoredRemotePath(rootPath, absPath)) continue;
    yield absPath;
  }
}

export function buildFindPruneExpression(): string {
  const ignoredNames = IGNORED_PATH_SEGMENTS.map((name) => `-name ${quoteShellArg(name)}`).join(
    ' -o '
  );
  return ignoredNames ? `\\( ${ignoredNames} \\) -prune -o ` : '';
}

function buildRemoteEnumerationCommand(rootPath: string): string {
  const pruneExpression = buildFindPruneExpression();
  const enumerateScript = `
for p do
  rel=\${p#./}
  [ "$rel" = "." ] && continue
  printf '%s\\0' "$rel"
done
`.trim();

  return [
    `cd ${quoteShellArg(rootPath)} || exit 1`,
    `find . ${pruneExpression}-type f -exec sh -c ${quoteShellArg(enumerateScript)} sh {} +`,
  ].join('\n');
}

async function* execRemoteNulFields(proxy: SshClientProxy, command: string): AsyncIterable<string> {
  const profile = await proxy.getRemoteShellProfile();
  const fullCommand = buildRemoteShellCommand(profile, command);
  const decoder = new StringDecoder('utf8');
  const queue: string[] = [];
  let stream: ClientChannel | undefined;
  let pending = '';
  let stderr = '';
  let done = false;
  let error: unknown;
  let notify: (() => void) | undefined;

  const wake = () => {
    notify?.();
    notify = undefined;
  };
  const waitForEvent = () =>
    new Promise<void>((resolve) => {
      notify = resolve;
    });

  await new Promise<void>((resolve, reject) => {
    proxy.exec(fullCommand, (err, channel) => {
      if (err) {
        reject(err);
        return;
      }

      stream = channel;
      channel.on('data', (chunk: Buffer) => {
        const text = pending + decoder.write(chunk);
        const parts = text.split('\0');
        pending = parts.pop() ?? '';
        queue.push(...parts);
        wake();
      });
      channel.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      channel.on('close', (exitCode: number | null) => {
        const tail = pending + decoder.end();
        if (tail) queue.push(tail);
        pending = '';
        if ((exitCode ?? 0) !== 0) {
          error = new Error(stderr.trim() || `Remote command exited with code ${exitCode}`);
        }
        done = true;
        wake();
      });
      channel.on('error', (streamError: Error) => {
        error = streamError;
        done = true;
        wake();
      });
      resolve();
    });
  });

  try {
    while (!done || queue.length > 0) {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item) yield item;
      }
      if (error) throw error;
      if (!done) await waitForEvent();
    }
    if (error) throw error;
  } finally {
    if (!done) stream?.destroy();
  }
}
