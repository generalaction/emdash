import { describe, expect, it, vi } from 'vitest';
import { redactDiagnosticLog } from './file-logger';

vi.mock('electron', () => ({
  app: {
    exit: vi.fn(),
    getPath: vi.fn(() => '/tmp/emdash-test'),
    setAppLogsPath: vi.fn(),
  },
}));

describe('redactDiagnosticLog', () => {
  it('redacts common secrets in free-form text', () => {
    const redacted = redactDiagnosticLog(
      [
        'authorization: Bearer abc123',
        'api_key=super-secret-key',
        'token: ghp_123456',
        'password=hunter2',
        'sk-abcdefghijklmnopqrstuvwxyz123456',
      ].join('\n')
    );

    expect(redacted).toContain('authorization: [REDACTED]');
    expect(redacted).toContain('api_key=[REDACTED]');
    expect(redacted).toContain('token: [REDACTED]');
    expect(redacted).toContain('password=[REDACTED]');
    expect(redacted).toContain('[REDACTED_OPENAI_KEY]');
  });

  it('redacts secrets embedded in JSON-quoted values', () => {
    const redacted = redactDiagnosticLog(
      JSON.stringify({
        password: 'hunter2',
        api_key: 'super-secret-key',
        authorization: 'Bearer xyz',
        access_token: 'abc',
      })
    );

    expect(redacted).not.toContain('hunter2');
    expect(redacted).not.toContain('super-secret-key');
    expect(redacted).not.toContain('Bearer xyz');
    expect(redacted).not.toContain('"abc"');
    expect(redacted).toContain('[REDACTED]');
  });

  it('redacts secrets embedded in escaped JSON-in-JSON strings', () => {
    const inner = JSON.stringify({ password: 'hunter2' });
    const outer = JSON.stringify({ message: inner });

    const redacted = redactDiagnosticLog(outer);

    expect(redacted).not.toContain('hunter2');
  });

  it('redacts vendor-specific tokens', () => {
    const redacted = redactDiagnosticLog(
      [
        'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'glpat-aaaaaaaaaaaaaaaaaaaa',
        'AKIAABCDEFGHIJKLMNOP',
        'sk_live_aaaaaaaaaaaaaaaaaaaa',
        'sk-ant-aaaaaaaaaaaaaaaaaaaaaaaa',
        'xoxb-redacted-example-token',
        'eyJabcdefgh.eyJabcdefgh.signaturebits',
        'npm_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ].join('\n')
    );

    expect(redacted).toContain('[REDACTED_GITHUB_TOKEN]');
    expect(redacted).toContain('[REDACTED_GITLAB_TOKEN]');
    expect(redacted).toContain('[REDACTED_AWS_KEY]');
    expect(redacted).toContain('[REDACTED_STRIPE_KEY]');
    expect(redacted).toContain('[REDACTED_ANTHROPIC_KEY]');
    expect(redacted).toContain('[REDACTED_SLACK_TOKEN]');
    expect(redacted).toContain('[REDACTED_JWT]');
    expect(redacted).toContain('[REDACTED_NPM_TOKEN]');
  });

  it('redacts PEM private-key blocks', () => {
    const pem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEpAIBAAKCAQEAxyz...',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');

    expect(redactDiagnosticLog(pem)).toBe('[REDACTED_PEM_BLOCK]');
  });

  it('redacts credentials in non-HTTPS DSNs', () => {
    const redacted = redactDiagnosticLog(
      [
        'postgres://admin:s3cret@db.internal/app',
        'mongodb://user:pass@cluster.example.com',
        'redis://default:topsecret@cache.local:6379',
      ].join('\n')
    );

    expect(redacted).toContain('postgres://[REDACTED_CREDENTIALS]@');
    expect(redacted).toContain('mongodb://[REDACTED_CREDENTIALS]@');
    expect(redacted).toContain('redis://[REDACTED_CREDENTIALS]@');
    expect(redacted).not.toContain('s3cret');
    expect(redacted).not.toContain('topsecret');
  });

  it('redacts common PII while keeping useful path shape', () => {
    const redacted = redactDiagnosticLog(
      [
        'email person@example.com',
        'mac /Users/alice/projects/emdash',
        'linux /home/bob/work/repo',
        'win C:\\Users\\carol\\repo',
        'ipv4 192.168.1.25',
        'ipv6 2001:0db8:85a3:0000:0000:8a2e:0370:7334',
        'macaddr aa:bb:cc:dd:ee:ff',
        'remote git@github.com',
        'url https://alice:secret@example.com/repo',
      ].join('\n')
    );

    expect(redacted).toContain('[REDACTED_EMAIL]');
    expect(redacted).toContain('/Users/[REDACTED_USER]/projects/emdash');
    expect(redacted).toContain('/home/[REDACTED_USER]/work/repo');
    expect(redacted).toContain('C:\\Users\\[REDACTED_USER]\\repo');
    expect(redacted).toContain('ipv4 [REDACTED_IP]');
    expect(redacted).toContain('ipv6 [REDACTED_IP]');
    expect(redacted).toContain('macaddr [REDACTED_MAC]');
    expect(redacted).toContain('git@[REDACTED_HOST]');
    expect(redacted).toContain('https://[REDACTED_CREDENTIALS]@example.com/repo');
  });
});
