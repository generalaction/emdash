import { describe, it, expect } from 'vitest';
import { configSchema, type Automation } from '../config.js';
import { buildContainerScript, buildDockerArgv } from './docker.js';

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  // Parse through the schema so defaults (image, timeoutMs, push) are applied.
  const cfg = configSchema.parse({
    apiKey: 'k',
    dbPath: ':memory:',
    automations: [
      {
        token: 'wh_test',
        repoPath: '/opt/projects/doc-engine',
        prompt: 'Scan for vulnerabilities',
        ...overrides,
      },
    ],
  });
  return cfg.automations[0]!;
}

describe('buildDockerArgv', () => {
  it('produces a throwaway container running as the host uid:gid', () => {
    const argv = buildDockerArgv({
      automation: makeAutomation(),
      oauthToken: 'oauth-xyz',
      uid: 1000,
      gid: 1000,
    });
    expect(argv[0]).toBe('run');
    expect(argv).toContain('--rm');
    const uIdx = argv.indexOf('-u');
    expect(uIdx).toBeGreaterThan(-1);
    expect(argv[uIdx + 1]).toBe('1000:1000');
  });

  it('mounts the repo at /work and sets it as the working dir', () => {
    const argv = buildDockerArgv({
      automation: makeAutomation({ repoPath: '/srv/repo' }),
      oauthToken: 't',
      uid: 1,
      gid: 1,
    });
    const vIdx = argv.indexOf('-v');
    expect(argv[vIdx + 1]).toBe('/srv/repo:/work');
    const wIdx = argv.indexOf('-w');
    expect(argv[wIdx + 1]).toBe('/work');
  });

  it('passes the OAuth token and prompt via env, and HOME=/tmp', () => {
    const argv = buildDockerArgv({
      automation: makeAutomation({ prompt: 'do the thing' }),
      oauthToken: 'secret-oauth',
      uid: 1,
      gid: 1,
    });
    expect(argv).toContain('CLAUDE_CODE_OAUTH_TOKEN=secret-oauth');
    expect(argv).toContain('PROMPT=do the thing');
    expect(argv).toContain('HOME=/tmp');
  });

  it('NEVER passes ANTHROPIC_API_KEY (which would outrank the OAuth token)', () => {
    const argv = buildDockerArgv({
      automation: makeAutomation(),
      oauthToken: 't',
      uid: 1,
      gid: 1,
    });
    const joined = argv.join('\n');
    expect(joined).not.toContain('ANTHROPIC_API_KEY');
    expect(joined).not.toContain('ANTHROPIC_AUTH_TOKEN');
    // Exactly three -e flags: OAuth token, PROMPT, HOME. No host passthrough.
    const eCount = argv.filter((a) => a === '-e').length;
    expect(eCount).toBe(3);
  });

  it('uses the configured image and invokes bash -lc', () => {
    const argv = buildDockerArgv({
      automation: makeAutomation({ image: 'custom-runner:v2' }),
      oauthToken: 't',
      uid: 1,
      gid: 1,
    });
    expect(argv).toContain('custom-runner:v2');
    const bashIdx = argv.indexOf('bash');
    expect(argv[bashIdx + 1]).toBe('-lc');
    expect(typeof argv[bashIdx + 2]).toBe('string');
  });

  it('does not shell-quote the prompt into the script (passed via env)', () => {
    // A prompt with quotes/backticks must not break the container script.
    const nasty = `it's a "test" with \`backticks\` and $(whoami)`;
    const argv = buildDockerArgv({
      automation: makeAutomation({ prompt: nasty }),
      oauthToken: 't',
      uid: 1,
      gid: 1,
    });
    // Prompt rides as a literal env value...
    expect(argv).toContain(`PROMPT=${nasty}`);
    // ...and the script references it as "$PROMPT", never inlining the text.
    const script = argv[argv.length - 1]!;
    expect(script).toContain('claude -p "$PROMPT"');
    expect(script).not.toContain(nasty);
  });
});

describe('buildContainerScript', () => {
  it('pulls, runs claude headless with skip-permissions, no push by default', () => {
    const script = buildContainerScript(makeAutomation());
    expect(script).toContain('git pull --ff-only');
    expect(script).toContain('claude -p "$PROMPT" --dangerously-skip-permissions');
    expect(script).not.toContain('git push');
  });

  it('adds git push when push is enabled', () => {
    const script = buildContainerScript(makeAutomation({ push: true }));
    expect(script).toContain('git push');
  });

  it('checks out the branch when configured', () => {
    const script = buildContainerScript(makeAutomation({ branch: 'auto/scan' }));
    expect(script).toContain("git checkout -B 'auto/scan'");
  });

  it('marks /work a safe.directory (root-owned mount under mapped uid)', () => {
    const script = buildContainerScript(makeAutomation());
    expect(script).toContain('safe.directory /work');
  });
});
