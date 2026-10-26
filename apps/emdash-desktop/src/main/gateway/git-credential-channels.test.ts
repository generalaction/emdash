import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { hostFileRef, parseAbsolute } from '@emdash/core/primitives/path/api';
import { TerminalsRuntime } from '@emdash/core/runtimes/terminals/node';
import { gitCredentialChannelsContract } from '@emdash/core/services/git-credential-channels/api';
import type { PtyExitInfo, PtyProcess, PtySpawner } from '@emdash/core/services/pty/api';
import { ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import { createTestWire } from '@emdash/wire/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createGitCredentialsService } from '@core/features/github/api/node/services/git-credentials-service';
import {
  bindGitCredentialChannels,
  createGitCredentialChannelsController,
} from '@core/features/github/node/services/git-credential-channels-controller';
import { GitCredentialServer } from '@core/features/github/node/services/git-credential-server';
import type { GitHubAccountSummary } from '@core/primitives/github/api';
import { makePtySessionId } from '@core/primitives/pty/api';

/**
 * The whole channel lifecycle across its owners, as the desktop wires it: the desktop
 * service and server mint and reuse a terminal's channel, the terminals runtime decides
 * which channel a shell runs with, and it releases channels through the parent-owned
 * release seam that `startDesktopWorkers` hands the terminals worker.
 */

const account: GitHubAccountSummary = {
  providerId: 'github',
  displayName: '@octocat',
  accountId: 'account-1',
  host: 'github.com',
  login: 'octocat',
  avatarUrl: 'https://example.invalid/a.png',
  credentialSource: 'emdash_oauth',
  isDefault: true,
};

const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger;

class FakeShell implements PtyProcess {
  private readonly exitHandlers: Array<(info: PtyExitInfo) => void> = [];
  write(): void {}
  resize(): void {}
  kill(): void {
    this.exit({ exitCode: null, signal: 'SIGTERM' });
  }
  onData(): void {}
  onExit(handler: (info: PtyExitInfo) => void): void {
    this.exitHandlers.push(handler);
  }
  getPid(): number {
    return 1;
  }
  exit(info: PtyExitInfo = { exitCode: 0, signal: null }): void {
    for (const handler of this.exitHandlers.splice(0)) handler(info);
  }
}

class FakeShellSpawner implements PtySpawner {
  readonly shells: FakeShell[] = [];
  readonly nonces: Array<string | undefined> = [];
  spawn(spec: Parameters<PtySpawner['spawn']>[0]): PtyProcess {
    this.nonces.push(spec.env?.EMDASH_GIT_CREDENTIAL_NONCE);
    const shell = new FakeShell();
    this.shells.push(shell);
    return shell;
  }
}

function harness() {
  const server = new GitCredentialServer({
    resolveProjectIntegrationAccount: async () => ({
      value: account,
      provenance: { kind: 'set' },
      accounts: [account],
      contextKey: '',
    }),
    listAccounts: async () => [account],
    readCredentials: async () => ok({ accessToken: 'token', apiBaseUrl: 'https://api.github.com' }),
    logger,
  });
  bindGitCredentialChannels(server);
  const release = createTestWire(
    gitCredentialChannelsContract,
    createGitCredentialChannelsController()
  );
  const service = createGitCredentialsService({
    getAgentGitCredentialsSetting: async () => 'effective-account',
    resolveProjectIntegrationAccount: async (_projectId, providerId) => ({
      value: providerId === 'github' ? account : null,
      provenance: { kind: 'set' },
      accounts: providerId === 'github' ? [account] : [],
      contextKey: '',
    }),
    listAccounts: async () => [account],
    channels: server,
    logger,
  });
  const scope = createScope({ label: 'test-git-credential-session-lifecycle' });
  const spawner = new FakeShellSpawner();
  const runtime = new TerminalsRuntime({
    spawner,
    scope,
    userEnv: async () => ({ PATH: '/usr/bin' }),
    releaseGitCredentialChannel: (nonce) => release.client.release({ nonce }),
  });
  const workspace = hostFileRef(LOCAL_HOST_REF, absolute('/repo'));

  /** What the terminals wire controller does on create and on every hydrate. */
  async function hydrate(terminalId: string) {
    const sessionId = makePtySessionId('project-1', 'task-1', terminalId);
    const gitCredentials = await service.resolveSessionSpec({
      sessionId,
      projectId: 'project-1',
      host: LOCAL_HOST_REF,
    });
    const started = await runtime.start({
      key: { workspace, id: sessionId },
      spec: { cwd: '/repo', env: {}, gitCredentials },
    });
    expect(started.success).toBe(true);
    if (gitCredentials?.mode !== 'effective-account') throw new Error('expected a channel');
    return gitCredentials.channel;
  }

  function kill(terminalId: string) {
    return runtime.kill({ workspace, id: makePtySessionId('project-1', 'task-1', terminalId) });
  }

  return {
    server,
    spawner,
    hydrate,
    kill,
    dispose: async () => {
      await scope.dispose();
      await release.dispose();
      server.stop();
    },
  };
}

async function credentialStatus(channel: { port: number; nonce: string }): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${channel.port}/git-credential/get`, {
    method: 'POST',
    headers: { 'X-Emdash-Token': channel.nonce },
    body: 'protocol=https\nhost=github.com\n',
  });
  await response.text();
  return response.status;
}

function absolute(path: string) {
  const parsed = parseAbsolute(path);
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

describe('Git credential channel lifecycle', () => {
  const harnesses: Array<ReturnType<typeof harness>> = [];
  afterEach(async () => {
    for (const current of harnesses.splice(0)) await current.dispose();
  });
  function track() {
    const current = harness();
    harnesses.push(current);
    return current;
  }

  it('does not mint a new channel when a live terminal is hydrated again', async () => {
    const { hydrate, spawner } = track();
    const first = await hydrate('terminal-1');

    const second = await hydrate('terminal-1');

    expect(second).toEqual(first);
    expect(spawner.nonces).toEqual([first.nonce]);
    expect(await credentialStatus(first)).toBe(200);
  });

  it('revokes the channel when the terminal is killed', async () => {
    const { hydrate, kill } = track();
    const channel = await hydrate('terminal-1');
    expect(await credentialStatus(channel)).toBe(200);

    await kill('terminal-1');

    expect(await credentialStatus(channel)).toBe(403);
  });

  it('revokes the channel when the shell exits, and restarts it with a new one', async () => {
    const { hydrate, spawner } = track();
    const first = await hydrate('terminal-1');

    spawner.shells[0]!.exit();
    await expect.poll(() => credentialStatus(first)).toBe(403);
    const restarted = await hydrate('terminal-1');

    expect(restarted.nonce).not.toBe(first.nonce);
    expect(spawner.nonces).toEqual([first.nonce, restarted.nonce]);
    expect(await credentialStatus(restarted)).toBe(200);
  });

  it('keeps a live terminal working while many other sessions come and go', async () => {
    const { hydrate, kill } = track();
    const longLived = await hydrate('long-lived');

    for (let index = 0; index < 600; index += 1) {
      await hydrate(`short-${index}`);
      await hydrate(`short-${index}`);
      await kill(`short-${index}`);
    }

    expect(await credentialStatus(longLived)).toBe(200);
  });
});
