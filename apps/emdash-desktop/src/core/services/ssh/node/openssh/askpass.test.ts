import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { secret } from '@emdash/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenSshConfig } from '../connect/resolve-ssh-connect-config';
import { createAskpass, answerPrompt } from './askpass';
import { runProcess } from './process';

const config: OpenSshConfig = {
  destination: 'work',
  hostname: 'work.example',
  username: 'alice',
  args: [],
  env: process.env,
  readyTimeout: 1000,
  keyPath: '/keys/work',
  keyFingerprint: createHash('sha256')
    .update(JSON.stringify(['/keys/work', 'original key']))
    .digest('hex'),
  password: secret('password-secret', 'test'),
  passphrase: secret('key-secret', 'test'),
};
const hostPrompt =
  "The authenticity of host 'work.example (1.2.3.4)' can't be established.\nED25519 key fingerprint is SHA256:example.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? ";
const dispose: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of dispose.splice(0)) await cleanup();
});

describe('askpass credential boundary', () => {
  it('discloses a password only for its bound account and destination', async () => {
    expect(await answerPrompt(config, "alice@work.example's password:", '', {})).toBe(
      'password-secret'
    );
  });
  it.each([
    "bob@work.example's password:",
    "alice@jump.example's password:",
    'Password:',
    'Verification code:',
    "Enter passphrase for key '/other/key':",
  ])('does not send credentials to an unrelated prompt: %s', async (prompt) => {
    expect(await answerPrompt(config, prompt, '', {})).toBeNull();
  });
  it('discloses a passphrase only for the bound key', async () => {
    expect(
      await answerPrompt(config, "Enter passphrase for key '/keys/work':", '', {
        readKey: async () => 'original key',
      })
    ).toBe('key-secret');
  });
  it('does not disclose a retained passphrase after the key file is replaced', async () => {
    expect(
      await answerPrompt(config, "Enter passphrase for key '/keys/work':", '', {
        readKey: async () => 'replaced key',
      })
    ).toBeNull();
  });
  it('does not disclose a passphrase when the key can no longer be inspected', async () => {
    expect(
      await answerPrompt(config, "Enter passphrase for key '/keys/work':", '', {
        readKey: async () => {
          throw new Error('ENOENT');
        },
      })
    ).toBeNull();
  });
  it('requires explicit host confirmation', async () => {
    expect(await answerPrompt(config, hostPrompt, 'confirm', {})).toBeNull();
    expect(
      await answerPrompt(config, hostPrompt, 'confirm', { confirmHost: async () => false })
    ).toBeNull();
    expect(
      await answerPrompt(config, hostPrompt, 'confirm', { confirmHost: async () => true })
    ).toBe('yes');
  });
  it('does not return credentials for a confirmation prompt', async () => {
    expect(await answerPrompt(config, "alice@work.example's password:", 'confirm', {})).toBeNull();
  });
  it('does not mistake agent-key storage confirmation for host trust', async () => {
    const confirmHost = vi.fn(async () => true);
    expect(
      await answerPrompt(config, 'Add key /keys/work to agent?', 'confirm', { confirmHost })
    ).toBeNull();
    expect(confirmHost).not.toHaveBeenCalled();
  });
  it('does not answer prompts after cancellation', async () => {
    const confirmHost = vi.fn(async () => true);
    await expect(
      answerPrompt(config, 'Trust?', 'confirm', { signal: AbortSignal.abort(), confirmHost })
    ).rejects.toThrow();
    expect(confirmHost).not.toHaveBeenCalled();
  });
  it('keeps secret values out of helper files and environment', async () => {
    const helper = await createAskpass(config);
    dispose.push(helper.dispose);
    expect(JSON.stringify(helper.env)).not.toMatch(/password-secret|key-secret/);
    expect(await readFile(helper.env.SSH_ASKPASS!, 'utf8')).not.toMatch(
      /password-secret|key-secret/
    );
  });
  it.runIf(process.platform !== 'win32')(
    'round-trips a real helper process without a shell-expanded prompt',
    async () => {
      const helper = await createAskpass(config);
      dispose.push(helper.dispose);
      const result = await runProcess({
        executable: helper.env.SSH_ASKPASS!,
        args: ["alice@work.example's password:"],
        env: { ...process.env, ...helper.env },
      });
      expect(result).toEqual({ stdout: 'password-secret\n', stderr: '', exitCode: 0 });
    }
  );
  it('rejects requests without the per-session capability', async () => {
    const helper = await createAskpass(config);
    dispose.push(helper.dispose);
    const response = await fetch(helper.env.EMDASH_SSH_ASKPASS_ENDPOINT!, {
      method: 'POST',
      body: JSON.stringify({ token: 'wrong', prompt: "alice@work.example's password:" }),
    });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('password-secret');
  });
});

it('does not disclose a secret after an in-flight host confirmation is cancelled', async () => {
  const abort = new AbortController();
  let confirm: (accepted: boolean) => void = () => {};
  const pending = answerPrompt(config, hostPrompt, 'confirm', {
    signal: abort.signal,
    confirmHost: () =>
      new Promise<boolean>((resolve) => {
        confirm = resolve;
      }),
  });
  const rejected = expect(pending).rejects.toThrow();
  abort.abort();
  confirm(true);
  await rejected;
});
it.each(['malformed', 'unicode-token', 'missing-prompt', 'wrong-method'])(
  'rejects an invalid broker request: %s',
  async (kind) => {
    const helper = await createAskpass(config);
    dispose.push(helper.dispose);
    const response = await fetch(helper.env.EMDASH_SSH_ASKPASS_ENDPOINT!, {
      method: kind === 'wrong-method' ? 'PUT' : 'POST',
      body:
        kind === 'malformed'
          ? '{'
          : JSON.stringify({
              token:
                kind === 'unicode-token' ? 'é'.repeat(64) : helper.env.EMDASH_SSH_ASKPASS_TOKEN,
              prompt: kind === 'missing-prompt' ? undefined : "alice@work.example's password:",
            }),
    });
    expect(response.status).toBe(kind === 'malformed' || kind === 'missing-prompt' ? 400 : 403);
    expect(await response.text()).not.toContain('password-secret');
  }
);
