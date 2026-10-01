import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitWithSignal } from '@emdash/shared/scheduling';
import { SshConnectionFailure } from '@core/primitives/ssh/api/node/connection-control';
import type { HostTrustPrompt } from '../../api/host-trust';
import type { OpenSshConfig } from '../connect/resolve-ssh-connect-config';
import { createAskpass } from './askpass';
import { SshInteraction } from './interaction';
import { prepareHostKeyRecovery, publicKeyFingerprint } from './known-hosts-recovery';
import { runProcess } from './process';
import { connectOpenSsh, nativeSessionArgs, type SshSession } from './session';

/** A failed verification can resume once after explicit approval. No automatic retry policy. */
export async function connectWithHostTrust(
  config: OpenSshConfig,
  options: {
    signal: AbortSignal;
    interaction?: SshInteraction;
    confirm(prompt: HostTrustPrompt): Promise<boolean>;
  }
): Promise<SshSession> {
  const { signal } = options;
  const interaction = options.interaction ?? new SshInteraction();
  const profile = { ...config, args: ['-o', 'FingerprintHash=sha256', ...config.args] };
  const connect = (recovering = false) =>
    connectOpenSsh(
      recovering
        ? { ...profile, args: ['-o', 'StrictHostKeyChecking=yes', ...profile.args] }
        : profile,
      {
        signal,
        interaction,
        confirmHost: recovering
          ? async () => false
          : (prompt) =>
              options.confirm({ kind: 'unknown', destination: config.destination, prompt }),
      }
    );
  let failure: unknown;
  try {
    return await connect();
  } catch (error) {
    signal.throwIfAborted();
    failure = error;
  }
  if (
    !(failure instanceof Error) ||
    !failure.message.includes('REMOTE HOST IDENTIFICATION HAS CHANGED')
  )
    throw failure;
  try {
    await recoverHostKey(profile, failure.message, { ...options, interaction });
  } catch (error) {
    signal.throwIfAborted();
    throw new SshConnectionFailure(
      'host-key',
      error instanceof Error ? error.message : String(error),
      { cause: error }
    );
  }
  // Native verification runs again; another key change stays blocked without a second prompt.
  return connect(true);
}

async function recoverHostKey(
  config: OpenSshConfig,
  diagnostic: string,
  options: {
    signal: AbortSignal;
    interaction: SshInteraction;
    confirm(prompt: HostTrustPrompt): Promise<boolean>;
  }
): Promise<void> {
  const { signal, interaction } = options;
  const recovery = await prepareHostKeyRecovery(config, diagnostic, signal).catch(
    (error: unknown) => {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n\n${diagnostic}`,
        { cause: error }
      );
    }
  );
  if (!recovery) throw new Error(diagnostic);
  const resume = interaction.begin();
  let accepted: boolean;
  try {
    accepted = await waitWithSignal(options.confirm(recovery.prompt), signal);
  } finally {
    resume();
  }
  signal.throwIfAborted();
  if (!accepted)
    throw new Error('SSH host key replacement canceled. The saved key has not changed.');

  // Probe through the original route, in a private copy of user trust. No target credentials,
  // agent signatures, forwarding, or remote commands are allowed before the key is pinned.
  const directory = await mkdtemp(join(tmpdir(), 'emdash-host-key-'));
  const candidateFile = join(directory, 'known_hosts');
  const probe = { ...config, password: undefined, passphrase: undefined };
  let observed = false;
  let askpass: Awaited<ReturnType<typeof createAskpass>> | undefined;
  try {
    askpass = await createAskpass(probe, {
      signal,
      confirmHost: async (prompt) => {
        const fingerprint = prompt.match(
          /^\S+ key fingerprint is:? (SHA256:[A-Za-z0-9+/]{43})\.?\r?$/m
        )?.[1];
        observed =
          fingerprint === recovery.fingerprint &&
          prompt.startsWith(`The authenticity of host '${recovery.host} (`);
        return observed;
      },
    });
    await writeFile(candidateFile, recovery.withoutHost, { mode: 0o600 });
    const quote = (path: string) => `"${path}"`;
    const result = await runProcess(
      {
        executable: config.executable ?? 'ssh',
        args: [
          ...(await nativeSessionArgs(config, signal, 'none')),
          '-a',
          '-x',
          '-o',
          'StrictHostKeyChecking=ask',
          '-o',
          'BatchMode=no',
          '-o',
          `UserKnownHostsFile=${[candidateFile, ...recovery.otherFiles].map(quote).join(' ')}`,
          '-o',
          'HashKnownHosts=no',
          '-o',
          'UpdateHostKeys=no',
          '-o',
          'PreferredAuthentications=none',
          '-o',
          'PubkeyAuthentication=no',
          '-o',
          'PasswordAuthentication=no',
          '-o',
          'KbdInteractiveAuthentication=no',
          '-o',
          'HostbasedAuthentication=no',
          '-o',
          'ClearAllForwardings=yes',
          '-o',
          'ControlMaster=no',
          '-o',
          'ControlPath=none',
          '-o',
          'PermitLocalCommand=no',
          '-o',
          'RemoteCommand=none',
          ...config.args,
          '--',
          config.destination,
        ],
        env: { ...config.env, ...askpass.env },
      },
      { signal, timeoutMs: config.readyTimeout || 20_000 }
    );
    const contents = await readFile(candidateFile, 'utf8');
    const added = contents.startsWith(recovery.withoutHost)
      ? contents.slice(recovery.withoutHost.length).trim().split('\n')
      : [];
    const match = added.length === 1 ? added[0].match(/^(\S+)\s+(\S+\s+\S+)(?:\s.*)?$/) : undefined;
    if (
      !observed ||
      !match ||
      match[1] !== recovery.host ||
      publicKeyFingerprint(match[2]) !== recovery.fingerprint
    )
      throw new Error(
        `SSH host key could not be verified during recovery. The saved key has not changed.\n${result.stderr.trim()}`
      );
    await recovery.commit(match[2]);
  } finally {
    await askpass?.dispose();
    await rm(directory, { force: true, recursive: true });
  }
}
