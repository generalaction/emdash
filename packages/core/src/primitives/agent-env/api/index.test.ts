import { describe, expect, it } from 'vitest';
import { buildAllowlistedAgentEnv, getWindowsEnvKey, mergeAgentEnvLayers } from './index';

describe('buildAllowlistedAgentEnv', () => {
  it('reads the full allowlist case-insensitively and emits canonical Windows names', () => {
    const env = buildAllowlistedAgentEnv(
      {
        Path: 'C:\\Tools',
        temp: 'C:\\Temp',
        Tmp: 'C:\\Tmp',
        SYSTEMROOT: 'C:\\Windows',
        WINDIR: 'C:\\Windows',
        COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
        pathext: '.COM;.EXE;.CMD',
        localappdata: 'C:\\Users\\ada\\AppData\\Local',
        userprofile: 'C:\\Users\\ada',
        username: 'ada',
        anthropic_api_key: 'secret',
        https_proxy: 'https://proxy.test',
        unsafe_env: 'excluded',
      },
      { platform: 'windows' }
    );

    expect(env).toMatchObject({
      HOME: 'C:\\Users\\ada',
      USER: 'ada',
      PATH: 'C:\\Tools',
      TEMP: 'C:\\Temp',
      TMP: 'C:\\Tmp',
      SystemRoot: 'C:\\Windows',
      windir: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      PATHEXT: '.COM;.EXE;.CMD',
      LOCALAPPDATA: 'C:\\Users\\ada\\AppData\\Local',
      USERPROFILE: 'C:\\Users\\ada',
      ANTHROPIC_API_KEY: 'secret',
      HTTPS_PROXY: 'https://proxy.test',
    });
    expect(env).not.toHaveProperty('Path');
    expect(env).not.toHaveProperty('username');
    expect(env).not.toHaveProperty('unsafe_env');
  });

  it('prefers an exact canonical spelling over duplicate casing variants', () => {
    const env = buildAllowlistedAgentEnv(
      {
        Path: 'C:\\first',
        pAtH: 'C:\\last-noncanonical',
        PATH: 'C:\\canonical',
      },
      { platform: 'windows' }
    );

    expect(env.PATH).toBe('C:\\canonical');
  });

  it('uses the last defined casing variant when no canonical spelling exists', () => {
    const source = { Path: 'C:\\first', pAtH: 'C:\\last', PATH: undefined };

    expect(getWindowsEnvKey(source, 'PATH')).toBe('pAtH');
    expect(buildAllowlistedAgentEnv(source, { platform: 'windows' }).PATH).toBe('C:\\last');
  });

  it('does not fall through an explicitly empty canonical value', () => {
    const env = buildAllowlistedAgentEnv(
      {
        Path: 'C:\\noncanonical',
        PATH: '',
        anthropic_api_key: 'noncanonical',
        ANTHROPIC_API_KEY: '',
      },
      { platform: 'windows' }
    );

    expect(env.PATH).toBe('');
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('keeps POSIX lookups case-sensitive', () => {
    const env = buildAllowlistedAgentEnv(
      {
        Path: '/wrong',
        PATH: '/bin',
        anthropic_api_key: 'excluded',
        ANTHROPIC_API_KEY: 'included',
      },
      { platform: 'posix' }
    );

    expect(env.PATH).toBe('/bin');
    expect(env.ANTHROPIC_API_KEY).toBe('included');
  });

  it('forwards supported Prime configuration without leaking internal daemon state', () => {
    const env = buildAllowlistedAgentEnv({
      HOME: '/home/ada',
      PATH: '/usr/bin',
      PRIME_AGENT_CODING_AGENT_DIR: '/configs/prime-agent',
      PRIME_AGENT_SESSION_DIR: '/sessions/prime-agent',
      PRIME_AGENT_KERNEL_PYTHON: '/opt/prime/kernel-python',
      PRIME_AGENT_TELEMETRY: 'off',
      PRIME_API_KEY: 'prime-secret',
      PRIME_TEAM_ID: 'team-1',
      RLM_MAX_DEPTH: '3',
      PRIME_AGENT_INTERNAL_DAEMON_WORKER_TOKEN: 'do-not-forward',
    });

    expect(env).toMatchObject({
      PRIME_AGENT_CODING_AGENT_DIR: '/configs/prime-agent',
      PRIME_AGENT_SESSION_DIR: '/sessions/prime-agent',
      PRIME_AGENT_KERNEL_PYTHON: '/opt/prime/kernel-python',
      PRIME_AGENT_TELEMETRY: 'off',
      PRIME_API_KEY: 'prime-secret',
      PRIME_TEAM_ID: 'team-1',
      RLM_MAX_DEPTH: '3',
    });
    expect(env.PRIME_AGENT_INTERNAL_DAEMON_WORKER_TOKEN).toBeUndefined();
  });
});

describe('mergeAgentEnvLayers', () => {
  it('lets later Windows layers win without emitting duplicate casing variants', () => {
    const env = mergeAgentEnvLayers(
      'windows',
      { PATH: 'C:\\base', ProviderValue: 'base' },
      {
        Path: 'C:\\plugin',
        providervalue: 'plugin',
        anthropic_api_key: 'provider-secret',
      },
      { pAtH: 'C:\\caller' }
    );

    expect(env).toEqual({
      PATH: 'C:\\caller',
      ProviderValue: 'plugin',
      ANTHROPIC_API_KEY: 'provider-secret',
    });
    expect(Object.keys(env).filter((key) => key.toLowerCase() === 'path')).toEqual(['PATH']);
  });

  it('preserves normal case-sensitive overlay behavior on POSIX', () => {
    expect(mergeAgentEnvLayers('posix', { PATH: '/bin' }, { Path: '/other' })).toEqual({
      PATH: '/bin',
      Path: '/other',
    });
  });
});
