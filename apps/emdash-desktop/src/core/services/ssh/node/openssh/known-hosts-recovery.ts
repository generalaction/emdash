import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, renameSync } from 'node:fs';
import { lstat, open, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute } from 'node:path';
import type { HostTrustPrompt } from '../../api/host-trust';
import type { OpenSshConfig } from '../connect/resolve-ssh-connect-config';
import { runProcess } from './process';

const manual = () =>
  new Error(
    'SSH host key recovery requires manual review of the OpenSSH known_hosts configuration. Verify the new fingerprint with your administrator, update the affected entry, then Retry.'
  );

export function publicKeyFingerprint(key: string): string {
  const fields = key.trim().split(/\s+/);
  if (fields.length < 2 || !/^[A-Za-z0-9+/]+={0,2}$/.test(fields[1])) throw manual();
  return `SHA256:${createHash('sha256').update(Buffer.from(fields[1], 'base64')).digest('base64').replace(/=+$/, '')}`;
}

/** A reviewable snapshot, never a renderer-supplied path or an instruction parsed from stderr. */
export async function prepareHostKeyRecovery(
  config: OpenSshConfig,
  diagnostic: string,
  signal: AbortSignal
) {
  if (!diagnostic.includes('REMOTE HOST IDENTIFICATION HAS CHANGED') || /revoked/i.test(diagnostic))
    return undefined;
  const offered = diagnostic.match(
    /The fingerprint for the [^\r\n]+ key sent by the remote host is\r?\n(SHA256:[A-Za-z0-9+/]+)\.?/
  );
  const offending = diagnostic.match(/^Offending \S+ key in (.+):(\d+)\r?$/m);
  if (!offered || !offending) throw manual();
  const resolved = await runProcess(
    {
      executable: config.executable ?? 'ssh',
      args: ['-G', ...config.args, '--', config.destination],
      env: { ...config.env, LC_ALL: 'C' },
    },
    { signal, timeoutMs: 5000 }
  );
  if (resolved.exitCode !== 0) throw manual();
  const values = new Map(
    resolved.stdout
      .trim()
      .split('\n')
      .map((line) => {
        const space = line.indexOf(' ');
        return [line.slice(0, space), line.slice(space + 1).trim()];
      })
  );
  const hostname = values.get('hostname');
  const port = values.get('port');
  const alias = values.get('hostkeyalias');
  if (
    !hostname ||
    !port ||
    values.get('checkhostip') === 'yes' ||
    (values.get('knownhostscommand') && values.get('knownhostscommand') !== 'none')
  )
    throw manual();
  const host =
    alias && alias !== 'none' ? alias : port === '22' ? hostname : `[${hostname}]:${port}`;
  const expand = (path: string) => {
    const expanded = path.replace(/^~\//, `${homedir()}/`).replace(
      /%[%dhpnr]/g,
      (token) =>
        ({
          '%%': '%',
          '%d': homedir(),
          '%h': hostname,
          '%p': port,
          '%n': config.destination,
          '%r': config.username,
        })[token]!
    );
    if (!isAbsolute(expanded) || /[\s%$"\r\n\0]/.test(expanded)) throw manual();
    return expanded;
  };
  // ssh -G does not retain quoting between multiple paths. Ambiguous paths stay manual.
  const files = (values.get('userknownhostsfile') ?? '')
    .split(/\s+/)
    .filter((path) => path && path !== 'none')
    .map(expand);
  const file = files.find((path) => path === offending[1]);
  if (!file) throw manual();
  const stat = await lstat(file);
  if (
    !stat.isFile() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o200) === 0 ||
    (stat.mode & 0o022) !== 0 ||
    stat.size > 4 * 1024 * 1024 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw manual();
  const original = await readFile(file, 'utf8');
  const found = await runProcess(
    {
      executable: 'ssh-keygen',
      args: ['-F', host, '-f', file],
      env: { ...config.env, LC_ALL: 'C' },
    },
    { signal, timeoutMs: 5000 }
  );
  if (found.exitCode !== 0) throw manual();
  const indexes = [...found.stdout.matchAll(/^# Host .+ found: line (\d+)[ \t]*\r?$/gm)].map(
    (match) => Number(match[1]) - 1
  );
  if (!indexes.includes(Number(offending[2]) - 1)) throw manual();
  const lines = original.split('\n');
  const fingerprints: string[] = [];
  let replacementHost = host;
  for (const index of indexes) {
    const line = lines[index];
    const entry = line?.replace(/\r$/, '').match(/^(\S+)(\s+)(\S+\s+\S+.*)$/);
    if (!entry || entry[1].startsWith('@') || /[*?!]/.test(entry[1])) throw manual();
    const hosts = entry[1].split(',');
    const hashed = entry[1].startsWith('|1|');
    if (hashed && hosts.length !== 1) throw manual();
    if (!hashed && !hosts.some((name) => name.toLowerCase() === host.toLowerCase())) throw manual();
    fingerprints.push(publicKeyFingerprint(entry[3]));
    if (hashed) replacementHost = entry[1];
    const retained = hashed
      ? []
      : hosts.filter((name) => name.toLowerCase() !== host.toLowerCase());
    lines[index] = retained.length
      ? `${retained.join(',')}${entry[2]}${entry[3]}${line.endsWith('\r') ? '\r' : ''}`
      : '';
  }
  const removed = new Set(indexes.filter((index) => lines[index] === ''));
  const withoutHost = lines.filter((_, index) => !removed.has(index)).join('\n');
  const prompt: HostTrustPrompt = {
    kind: 'changed',
    destination: config.destination,
    host,
    knownHostsFile: file,
    previousFingerprints: [...new Set(fingerprints)],
    fingerprint: offered[1],
  };

  return {
    prompt,
    host,
    fingerprint: offered[1],
    withoutHost,
    otherFiles: files.filter((path) => path !== file),
    async commit(key: string): Promise<void> {
      if (publicKeyFingerprint(key) !== offered[1])
        throw new Error(
          'SSH host key changed again during recovery. Reconnect to review the current fingerprint.'
        );
      const newline = original.includes('\r\n') ? '\r\n' : '\n';
      const next = `${withoutHost}${withoutHost.endsWith('\n') ? '' : newline}${replacementHost} ${key}${newline}`;
      const temporary = `${file}.emdash-${randomUUID()}`;
      // An exclusive sibling lock serializes Emdash's writers. Compare again immediately before
      // atomic rename so edits made by external tools while the modal/probe was open survive.
      const lock = await open(`${file}.emdash-lock`, 'wx', 0o600).catch(() => {
        throw new Error(
          'SSH known_hosts is already being updated. Retry after the other recovery finishes.'
        );
      });
      try {
        const output = await open(temporary, 'wx', stat.mode & 0o777);
        try {
          await output.writeFile(next);
          await output.chmod(stat.mode & 0o777);
          await output.sync();
        } finally {
          await output.close();
        }
        signal.throwIfAborted();
        const current = lstatSync(file);
        if (
          !current.isFile() ||
          current.dev !== stat.dev ||
          current.ino !== stat.ino ||
          current.mode !== stat.mode ||
          current.nlink !== 1 ||
          readFileSync(file, 'utf8') !== original
        )
          throw new Error(
            'SSH known_hosts changed during review. Retry to review the updated trust entry.'
          );
        renameSync(temporary, file);
      } finally {
        await lock.close();
        await rm(`${file}.emdash-lock`, { force: true });
        await rm(temporary, { force: true });
      }
    },
  };
}
