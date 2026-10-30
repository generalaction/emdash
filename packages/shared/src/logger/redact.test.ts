import { describe, expect, it } from 'vitest';
import { redactAll, redactPii, redactSecrets } from './redact';

// Shaped like a GitHub token without being one.
const GITHUB_TOKEN = `ghp_${'a'.repeat(36)}`;

describe('redactSecrets', () => {
  it('redacts authorization headers', () => {
    expect(redactSecrets('authorization: Bearer abc123')).toContain('[REDACTED]');
  });

  it('redacts the credential after a Basic or token auth scheme', () => {
    expect(redactSecrets('Authorization: Basic dXNlcjpzM2NyZXQ=')).toBe(
      'Authorization: [REDACTED]'
    );
    expect(redactSecrets('Proxy-Authorization: basic Zm9vOmJhcg==')).toBe(
      'Proxy-Authorization: [REDACTED]'
    );
    expect(redactSecrets('authorization: token abc123def')).toBe('authorization: [REDACTED]');
    expect(redactSecrets('authorization: Bearer abc123')).toBe('authorization: [REDACTED]');
  });

  it('redacts api_key= assignment', () => {
    expect(redactSecrets('api_key=super-secret-key')).toContain('[REDACTED]');
  });

  it('redacts token field', () => {
    expect(redactSecrets('token: ghp_123456')).toContain('[REDACTED]');
  });

  it('redacts GitHub tokens', () => {
    expect(redactSecrets('ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toContain(
      '[REDACTED_GITHUB_TOKEN]'
    );
  });

  it('redacts OpenAI keys', () => {
    expect(redactSecrets('sk-abcdefghijklmnopqrstuvwxyz123456')).toContain('[REDACTED_OPENAI_KEY]');
  });

  it('redacts PEM blocks', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpA\n-----END RSA PRIVATE KEY-----';
    expect(redactSecrets(pem)).toBe('[REDACTED_PEM_BLOCK]');
  });

  it('redacts credentials in DSNs', () => {
    expect(redactSecrets('postgres://user:pass@host/db')).toBe(
      'postgres://[REDACTED_CREDENTIALS]@host/db'
    );
  });

  it('keeps the host of a credential URL in a Git diagnostic', () => {
    const stderr = `fatal: unable to access 'https://x-access-token:${GITHUB_TOKEN}@github.com/acme/app.git/': The requested URL returned error: 403`;

    expect(redactSecrets(stderr)).toBe(
      "fatal: unable to access 'https://[REDACTED_CREDENTIALS]@github.com/acme/app.git/': The requested URL returned error: 403"
    );
  });

  it.each([
    ['classic', `ghp_${'a'.repeat(36)}`],
    ['OAuth', `gho_${'a'.repeat(36)}`],
    ['refresh', `ghr_${'a'.repeat(76)}`],
    ['fine-grained', `github_pat_${'A'.repeat(22)}_${'b'.repeat(59)}`],
  ])('redacts %s GitHub tokens', (_kind, token) => {
    expect(redactSecrets(`remote: ${token} rejected`)).toBe(
      'remote: [REDACTED_GITHUB_TOKEN] rejected'
    );
  });

  it('redacts GitLab tokens', () => {
    expect(redactSecrets(`https://gitlab.com/api/v4?private=glpat-${'x'.repeat(20)}`)).toBe(
      'https://gitlab.com/api/v4?private=[REDACTED_GITLAB_TOKEN]'
    );
  });

  it.each([
    ['> Authorization: Bearer abc.def', '> Authorization: [REDACTED]'],
    ['> Authorization: Basic dXNlcjpwYXNz', '> Authorization: [REDACTED]'],
    ['> Authorization: token abc123', '> Authorization: [REDACTED]'],
    ['> X-Emdash-Token: 0123abcd', '> X-Emdash-Token: [REDACTED]'],
  ])('redacts HTTP credential headers: %s', (header, expected) => {
    expect(redactSecrets(header)).toBe(expected);
  });

  it('leaves secret-free Git diagnostics intact', () => {
    const stderr = [
      'remote: Invalid username or token. Password authentication is not supported for Git operations.',
      "fatal: Authentication failed for 'https://github.com/acme/app.git/'",
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    ].join('\n');

    expect(redactSecrets(stderr)).toBe(stderr);
  });
});

describe('redactPii', () => {
  it('redacts email addresses', () => {
    expect(redactPii('person@example.com')).toContain('[REDACTED_EMAIL]');
  });

  it('redacts /Users/ paths', () => {
    expect(redactPii('/Users/alice/projects')).toContain('[REDACTED_USER]');
  });

  it('redacts /home/ paths', () => {
    expect(redactPii('/home/bob/work')).toContain('[REDACTED_USER]');
  });

  it('redacts IPv4 addresses', () => {
    expect(redactPii('192.168.1.25')).toContain('[REDACTED_IP]');
  });
});

describe('redactAll', () => {
  it('applies both secret and PII redaction', () => {
    const input = 'token: abc\nemail person@example.com';
    const result = redactAll(input);
    expect(result).toContain('[REDACTED]');
    expect(result).toContain('[REDACTED_EMAIL]');
  });
});
