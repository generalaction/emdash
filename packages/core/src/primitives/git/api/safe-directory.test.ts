import { describe, expect, it } from 'vitest';
import {
  parseGitDubiousOwnership,
  safeDirectoryCommand,
  safeDirectoryValueProblem,
} from './safe-directory';

function refusal(reportedPath: string, quotedValue: string, report = ''): string {
  return [
    `fatal: detected dubious ownership in repository at '${reportedPath}'`,
    `${report}To add an exception for this directory, call:`,
    '',
    `\tgit config --global --add safe.directory ${quotedValue}`,
    '',
  ].join('\n');
}

describe('parseGitDubiousOwnership', () => {
  it.each([
    ['an unquoted POSIX path', '/srv/repo', '/srv/repo', '/srv/repo'],
    ['a path with a space', '/srv/my repo', "'/srv/my repo'", '/srv/my repo'],
    ['a path with quotes', "/srv/it's!", "'/srv/it'\\''s'\\!''", "/srv/it's!"],
    ['a Windows drive path', 'C:/Users/me/repo', 'C:/Users/me/repo', 'C:/Users/me/repo'],
  ])('reads the suggested value for %s', (_label, reportedPath, quotedValue, safeDirectory) => {
    expect(
      parseGitDubiousOwnership({ exitCode: 128, stderr: refusal(reportedPath, quotedValue) })
    ).toEqual({ repositoryPath: reportedPath, safeDirectory });
  });

  it("keeps Git for Windows' %(prefix)/ marker for a WSL share, after its ownership report", () => {
    const repositoryPath = '//wsl.localhost/Ubuntu/home/me/repo';
    const report = [
      `'${repositoryPath}' is owned by:`,
      "\t'S-1-5-21-1-2-3-1001'",
      'but the current user is:',
      "\t'S-1-5-21-4-5-6-1001'",
      '',
    ].join('\n');
    const stderr = refusal(repositoryPath, `'%(prefix)/${repositoryPath}'`, report).replace(
      /\n/g,
      '\r\n'
    );

    expect(parseGitDubiousOwnership({ exitCode: 128, stderr })).toEqual({
      repositoryPath,
      safeDirectory: '%(prefix)///wsl.localhost/Ubuntu/home/me/repo',
    });
  });

  it('reads the unquoted suggestion of the first releases with the check', () => {
    const stderr = [
      "warning: safe.directory 'repo' not absolute",
      "fatal: unsafe repository ('/srv/my repo' is owned by someone else)",
      'To add an exception for this directory, call:',
      '',
      '\tgit config --global --add safe.directory /srv/my repo',
    ].join('\n');

    expect(parseGitDubiousOwnership({ exitCode: 128, stderr })).toEqual({
      repositoryPath: '/srv/my repo',
      safeDirectory: '/srv/my repo',
    });
  });

  it.each([
    [127, refusal('/srv/repo', '/srv/repo')],
    [null, refusal('/srv/repo', '/srv/repo')],
    [128, 'fatal: detected dubious ownership in repository'],
    [128, "fatal: detected dubious ownership in repository at '/srv/repo'\n"],
    [128, "fatal: cannot change to '/srv/repo': Permission denied"],
    [128, refusal('/srv/repo', "'/srv/unterminated")],
  ])('does not classify exit %s with stderr %j', (exitCode, stderr) => {
    expect(parseGitDubiousOwnership({ exitCode, stderr })).toBeNull();
  });
});

describe('safeDirectoryCommand', () => {
  const add = 'git config --global --add safe.directory';

  it.each([
    ['/srv/repo', `${add} /srv/repo`],
    ['/srv/my repo', `${add} '/srv/my repo'`],
    ["/srv/it's $HOME!", `${add} '/srv/it'\\''s $HOME!'`],
  ])('quotes a POSIX value %j for POSIX shells', (value, command) => {
    expect(safeDirectoryCommand(value)).toEqual({ command, requiresPowerShell: false });
  });

  // Git for Windows users paste into cmd.exe (Emdash's default terminal there), PowerShell or
  // Git Bash. Double quotes group the value in all three; single quotes do not in cmd.exe.
  it.each([
    ['C:/Users/me/repo', `${add} "C:/Users/me/repo"`],
    ["C:/Users/me/it's my (repo) & more", `${add} "C:/Users/me/it's my (repo) & more"`],
    [
      '%(prefix)///wsl.localhost/Ubuntu/home/me/my repo',
      `${add} "%(prefix)///wsl.localhost/Ubuntu/home/me/my repo"`,
    ],
  ])('double-quotes a Git for Windows value %j for every Windows shell', (value, command) => {
    expect(safeDirectoryCommand(value)).toEqual({ command, requiresPowerShell: false });
  });

  it.each([
    ['C:/Users/me/$work', `${add} 'C:/Users/me/$work'`],
    ["C:/Users/me/50% it's", `${add} 'C:/Users/me/50% it''s'`],
    ['%(prefix)///server/share/wow!', `${add} '%(prefix)///server/share/wow!'`],
    ['C:/Users/me/`tick`', `${add} 'C:/Users/me/\`tick\`'`],
  ])('falls back to PowerShell quoting when a Windows shell would expand %j', (value, command) => {
    expect(safeDirectoryCommand(value)).toEqual({ command, requiresPowerShell: true });
  });
});

describe('safeDirectoryValueProblem', () => {
  it.each([
    '/srv/repo',
    '/srv/my repo',
    'C:/Users/me/repo',
    'C:\\Users\\me\\repo',
    '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo',
    '%(prefix)///wsl.localhost/Ubuntu/home/me/repo',
    '%(prefix)///server/share/repo',
  ])('accepts one exact absolute path: %s', (value) => {
    expect(safeDirectoryValueProblem(value)).toBeNull();
  });

  it.each([
    ['', 'empty'],
    ['*', 'wildcard'],
    ['/srv/*', 'wildcard'],
    ['%(prefix)///server/share/*', 'wildcard'],
    ['/srv/re*po', 'wildcard'],
    ['.', 'not an absolute path'],
    ['repo', 'not an absolute path'],
    ['~/repo', 'not an absolute path'],
    ['%(prefix)/repo', 'not an absolute path'],
    ['/srv/repo/../other', 'relative path segments'],
    ['C:/Users/./me', 'relative path segments'],
    ['/srv/repo\n/other', 'control characters'],
  ])('rejects %j (%s)', (value, problem) => {
    expect(safeDirectoryValueProblem(value)).toContain(problem);
  });
});
