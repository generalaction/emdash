import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSshMasterArgs, openSshSlaveArgs, validateOpenSshTarget } from './openssh-options';

const target = { host: 'dev.example', username: 'alice', port: 22 };

describe('OpenSSH Kerberos arguments', () => {
  it('preserves the alias and verifies host keys without password prompts or inherited forwards', () => {
    const args = openSshMasterArgs(
      { ...target, sshConfigAlias: 'corp-dev' },
      '/tmp/ctl',
      {},
      'ready'
    );
    expect(args).toContain('StrictHostKeyChecking=yes');
    expect(args).toContain('BatchMode=yes');
    expect(args).toContain('PreferredAuthentications=gssapi-with-mic');
    expect(args).toContain('ClearAllForwardings=yes');
    expect(args).toContain('ControlPersist=no');
    expect(args.slice(-3)).toEqual(['--', 'corp-dev', "printf 'ready\\n'; cat"]);
    expect(args).not.toContain('-l');
    expect(args).not.toContain('-p');
  });

  it.skipIf(process.platform === 'win32')(
    'overrides inherited settings that detach or close the master',
    () => {
      const directory = mkdtempSync(join(tmpdir(), 'emdash-ssh-options-'));
      try {
        const config = join(directory, 'config');
        writeFileSync(config, 'Host *\n  StdinNull yes\n  ForkAfterAuthentication yes\n');
        const args = openSshMasterArgs(target, join(directory, 'ctl'), {}, 'ready');
        const effective = execFileSync('/usr/bin/ssh', ['-G', '-F', config, ...args], {
          encoding: 'utf8',
        });
        expect(effective).toMatch(/^stdinnull no$/m);
        expect(effective).toMatch(/^forkafterauthentication no$/m);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );

  it('honors explicit manual destination and jump host', () => {
    const args = openSshMasterArgs(
      { ...target, port: 2222, proxyJump: 'jump' },
      '/tmp/ctl',
      {},
      'ready'
    );
    expect(args).toEqual(expect.arrayContaining(['-p', '2222', '-l', 'alice', '-J', 'jump']));
    expect(args).toContain('ForwardAgent=no');
  });

  it('never falls back to a new physical connection for multiplexed operations', () => {
    expect(openSshSlaveArgs('/tmp/ctl')).toEqual(
      expect.arrayContaining([
        '-F',
        '/dev/null',
        '-S',
        '/tmp/ctl',
        'ProxyCommand=false',
        'ControlMaster=no',
      ])
    );
  });

  it.each(['-oProxyCommand=bad', 'host\nother', '$(touch bad)', 'host;bad'])(
    'rejects destination %s',
    (host) => {
      expect(() => validateOpenSshTarget({ ...target, host })).toThrow('Invalid SSH destination');
    }
  );

  it.each([0, 65536, 2.5, NaN])('rejects port %s', (port) => {
    expect(() => validateOpenSshTarget({ ...target, port })).toThrow('Invalid SSH port');
  });
});
