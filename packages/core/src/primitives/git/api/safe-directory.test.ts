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
  it.each([
    ['/srv/repo', 'git config --global --add safe.directory /srv/repo'],
    ['/srv/my repo', "git config --global --add safe.directory '/srv/my repo'"],
    ["/srv/it's!", "git config --global --add safe.directory '/srv/it'\\''s'\\!''"],
    [
      '%(prefix)///wsl.localhost/Ubuntu/home/me/repo',
      "git config --global --add safe.directory '%(prefix)///wsl.localhost/Ubuntu/home/me/repo'",
    ],
  ])('quotes %j the way Git suggests it', (value, command) => {
    expect(safeDirectoryCommand(value)).toBe(command);
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
