import { describe, expect, it } from 'vitest';
import {
  buildAllowlistedAgentEnv,
  getWindowsEnvKey,
  getWindowsEnvValue,
  mergeAgentEnvLayers,
} from './index';

// Representative desktop process environment on a domain-joined Windows 11 machine.
const WINDOWS_PROCESS_ENV = {
  ALLUSERSPROFILE: 'C:\\ProgramData',
  APPDATA: 'C:\\Users\\ada\\AppData\\Roaming',
  CommonProgramFiles: 'C:\\Program Files\\Common Files',
  'CommonProgramFiles(x86)': 'C:\\Program Files (x86)\\Common Files',
  CommonProgramW6432: 'C:\\Program Files\\Common Files',
  COMPUTERNAME: 'ADA-PC',
  ComSpec: 'C:\\WINDOWS\\system32\\cmd.exe',
  HOMEDRIVE: 'C:',
  HOMEPATH: '\\Users\\ada',
  LOCALAPPDATA: 'C:\\Users\\ada\\AppData\\Local',
  LOGONSERVER: '\\\\DC01',
  NUMBER_OF_PROCESSORS: '16',
  OS: 'Windows_NT',
  Path: 'C:\\WINDOWS\\system32;C:\\WINDOWS',
  PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC',
  PROCESSOR_ARCHITECTURE: 'AMD64',
  ProgramData: 'C:\\ProgramData',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  ProgramW6432: 'C:\\Program Files',
  PUBLIC: 'C:\\Users\\Public',
  SystemDrive: 'C:',
  SystemRoot: 'C:\\WINDOWS',
  TEMP: 'C:\\Users\\ada\\AppData\\Local\\Temp',
  TMP: 'C:\\Users\\ada\\AppData\\Local\\Temp',
  USERDNSDOMAIN: 'CORP.EXAMPLE.COM',
  USERDOMAIN: 'CORP',
  USERDOMAIN_ROAMINGPROFILE: 'CORP',
  USERNAME: 'ada',
  USERPROFILE: 'C:\\Users\\ada',
  windir: 'C:\\WINDOWS',
};

/** Mirrors Win32 ExpandEnvironmentStrings: undefined variables stay literal. */
function expandEnvironmentStrings(value: string, env: Record<string, string>): string {
  return value.replace(
    /%([^%]+)%/g,
    (token, name: string) => getWindowsEnvValue(env, name) ?? token
  );
}

describe('buildAllowlistedAgentEnv', () => {
  it.each(['posix', 'windows'] as const)(
    'forwards the Tsubasa key without allowing arbitrary Tsubasa variables on %s',
    (platform) => {
      const key = platform === 'windows' ? 'tsubasa_api_key' : 'TSUBASA_API_KEY';
      const env = buildAllowlistedAgentEnv(
        { [key]: 'tsubasa-test-key', TSUBASA_INTERNAL_TOKEN: 'excluded' },
        { platform }
      );

      expect(env.TSUBASA_API_KEY).toBe('tsubasa-test-key');
      expect(env).not.toHaveProperty('tsubasa_api_key');
      expect(env).not.toHaveProperty('TSUBASA_INTERNAL_TOKEN');
    }
  );

  it('does not forward a mis-cased or empty Tsubasa key on POSIX', () => {
    const env = buildAllowlistedAgentEnv(
      { tsubasa_api_key: 'excluded', TSUBASA_API_KEY: '' },
      { platform: 'posix' }
    );

    expect(env).not.toHaveProperty('TSUBASA_API_KEY');
    expect(env).not.toHaveProperty('tsubasa_api_key');
  });

  it('reads the full allowlist case-insensitively and emits canonical Windows names', () => {
    const env = buildAllowlistedAgentEnv(
      {
        Path: 'C:\\Tools',
        temp: 'C:\\Temp',
        Tmp: 'C:\\Tmp',
        SYSTEMDRIVE: 'C:',
        SYSTEMROOT: 'C:\\Windows',
        WINDIR: 'C:\\Windows',
        programdata: 'C:\\ProgramData',
        allusersprofile: 'C:\\ProgramData',
        public: 'C:\\Users\\Public',
        PROGRAMFILES: 'C:\\Program Files',
        'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
        programw6432: 'C:\\Program Files',
        COMMONPROGRAMFILES: 'C:\\Program Files\\Common Files',
        'commonprogramfiles(x86)': 'C:\\Program Files (x86)\\Common Files',
        commonprogramw6432: 'C:\\Program Files\\Common Files',
        COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
        pathext: '.COM;.EXE;.CMD',
        localappdata: 'C:\\Users\\ada\\AppData\\Local',
        userprofile: 'C:\\Users\\ada',
        homedrive: 'C:',
        homepath: '\\Users\\ada',
        username: 'ada',
        os: 'Windows_NT',
        processor_architecture: 'ARM64',
        number_of_processors: '8',
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
      SystemDrive: 'C:',
      SystemRoot: 'C:\\Windows',
      windir: 'C:\\Windows',
      ProgramData: 'C:\\ProgramData',
      ALLUSERSPROFILE: 'C:\\ProgramData',
      PUBLIC: 'C:\\Users\\Public',
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      ProgramW6432: 'C:\\Program Files',
      CommonProgramFiles: 'C:\\Program Files\\Common Files',
      'CommonProgramFiles(x86)': 'C:\\Program Files (x86)\\Common Files',
      CommonProgramW6432: 'C:\\Program Files\\Common Files',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      PATHEXT: '.COM;.EXE;.CMD',
      LOCALAPPDATA: 'C:\\Users\\ada\\AppData\\Local',
      USERPROFILE: 'C:\\Users\\ada',
      HOMEDRIVE: 'C:',
      HOMEPATH: '\\Users\\ada',
      USERNAME: 'ada',
      OS: 'Windows_NT',
      PROCESSOR_ARCHITECTURE: 'ARM64',
      NUMBER_OF_PROCESSORS: '8',
      ANTHROPIC_API_KEY: 'secret',
      HTTPS_PROXY: 'https://proxy.test',
    });
    expect(env).not.toHaveProperty('Path');
    expect(env).not.toHaveProperty('username');
    expect(env).not.toHaveProperty('unsafe_env');
  });

  it('lets Windows expand the system paths it stores as environment references', () => {
    const env = buildAllowlistedAgentEnv(WINDOWS_PROCESS_ENV, { platform: 'windows' });
    // Paths expanded against the agent's own environment, e.g. the registry's ProfileList known
    // folders (FOLDERID_ProgramData, FOLDERID_Public), COM server registrations, and the fixed
    // vswhere location build tools derive. Unexpanded, "%SystemDrive%\ProgramData" is a relative
    // path, which is how a "%SystemDrive%" folder tree ends up in the agent's cwd.
    const storedPaths = [
      '%SystemDrive%\\ProgramData',
      '%SystemDrive%\\Users\\Public',
      '%SystemRoot%\\System32\\shell32.dll',
      '%ProgramFiles%\\Windows Defender\\MpOav.dll',
      '%CommonProgramFiles%\\System\\Ole DB\\oledb32.dll',
      '%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\vswhere.exe',
    ];

    expect(storedPaths.map((value) => expandEnvironmentStrings(value, env))).toEqual([
      'C:\\ProgramData',
      'C:\\Users\\Public',
      'C:\\WINDOWS\\System32\\shell32.dll',
      'C:\\Program Files\\Windows Defender\\MpOav.dll',
      'C:\\Program Files\\Common Files\\System\\Ole DB\\oledb32.dll',
      'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe',
    ]);
  });

  it('does not forward Windows machine and domain identity variables', () => {
    const env = buildAllowlistedAgentEnv(WINDOWS_PROCESS_ENV, { platform: 'windows' });

    expect(env).not.toHaveProperty('COMPUTERNAME');
    expect(env).not.toHaveProperty('LOGONSERVER');
    expect(env).not.toHaveProperty('USERDOMAIN');
    expect(env).not.toHaveProperty('USERDOMAIN_ROAMINGPROFILE');
    expect(env).not.toHaveProperty('USERDNSDOMAIN');
  });

  it('only forwards the Windows system variables to Windows agents', () => {
    const env = buildAllowlistedAgentEnv(
      { ...WINDOWS_PROCESS_ENV, PATH: '/usr/bin' },
      { platform: 'posix' }
    );

    expect(env.PATH).toBe('/usr/bin');
    expect(env).not.toHaveProperty('SystemDrive');
    expect(env).not.toHaveProperty('ProgramFiles');
    expect(env).not.toHaveProperty('USERNAME');
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
        META_API_KEY: 'meta-secret',
      },
      { platform: 'posix' }
    );

    expect(env.PATH).toBe('/bin');
    expect(env.ANTHROPIC_API_KEY).toBe('included');
    expect(env.META_API_KEY).toBe('meta-secret');
  });

  it('forwards all persistent XDG base-directory variables', () => {
    const env = buildAllowlistedAgentEnv({
      XDG_CACHE_HOME: '/home/ada/.cache',
      XDG_CONFIG_HOME: '/home/ada/.config',
      XDG_DATA_HOME: '/home/ada/.local/share',
      XDG_STATE_HOME: '/home/ada/.local/state',
      XDG_UNSAFE_HOME: '/home/ada/.unsafe',
    });

    expect(env).toMatchObject({
      XDG_CACHE_HOME: '/home/ada/.cache',
      XDG_CONFIG_HOME: '/home/ada/.config',
      XDG_DATA_HOME: '/home/ada/.local/share',
      XDG_STATE_HOME: '/home/ada/.local/state',
    });
    expect(env.XDG_UNSAFE_HOME).toBeUndefined();
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
