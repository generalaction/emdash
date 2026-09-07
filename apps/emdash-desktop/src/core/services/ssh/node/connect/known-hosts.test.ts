import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hostKeyDecision } from './known-hosts';

const key = Buffer.from('ssh-ed25519-host-key-bytes');
const b64 = key.toString('base64');

describe('hostKeyDecision', () => {
  it('matches a known host key', () => {
    expect(
      hostKeyDecision('work.example', key, `work.example ssh-ed25519 ${b64}`)
    ).toBe('match');
  });

  it('rejects a changed host key', () => {
    expect(
      hostKeyDecision(
        'work.example',
        Buffer.from('other-key'),
        `work.example ssh-ed25519 ${b64}`
      )
    ).toBe('mismatch');
  });

  it('allows unknown hosts (tofu)', () => {
    expect(hostKeyDecision('new.example', key, `work.example ssh-ed25519 ${b64}`)).toBe(
      'unknown'
    );
  });

  it('matches hashed known_hosts hostnames', () => {
    const salt = Buffer.from('salt-value');
    const digest = createHmac('sha1', salt).update('work.example').digest('base64');
    const hashed = `|1|${salt.toString('base64')}|${digest}`;
    expect(hostKeyDecision('work.example', key, `${hashed} ssh-ed25519 ${b64}`)).toBe('match');
  });
});
