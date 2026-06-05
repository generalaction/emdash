import { createHmacSignature, verifyGithubSignature, generateApiKey, generateWebhookToken } from './crypto.js';
import { describe, it, expect } from 'vitest';

describe('generateApiKey', () => {
  it('returns a string starting with esk_', () => {
    expect(generateApiKey()).toMatch(/^esk_/);
  });
  it('returns unique values', () => {
    expect(generateApiKey()).not.toBe(generateApiKey());
  });
});

describe('generateWebhookToken', () => {
  it('returns a string starting with wh_', () => {
    expect(generateWebhookToken()).toMatch(/^wh_/);
  });
});

describe('verifyGithubSignature', () => {
  it('returns true for a valid signature', () => {
    const secret = 'mysecret';
    const payload = '{"action":"opened"}';
    const sig = createHmacSignature(secret, payload);
    expect(verifyGithubSignature(secret, payload, `sha256=${sig}`)).toBe(true);
  });
  it('returns false for an invalid signature', () => {
    expect(verifyGithubSignature('secret', 'payload', 'sha256=bad')).toBe(false);
  });
  it('returns false when no signature provided', () => {
    expect(verifyGithubSignature('secret', 'payload', undefined)).toBe(false);
  });
});
