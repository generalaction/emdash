import { describe, expect, it, vi } from 'vitest';
import {
  parseGithubOwnerRepo,
  resolveOwnerRepo,
  resolveProjectGithubInfo,
} from '../../renderer/lib/projectUtils';

describe('parseGithubOwnerRepo', () => {
  it('parses HTTPS remote', () => {
    expect(parseGithubOwnerRepo('https://github.com/myuser/myrepo.git')).toBe('myuser/myrepo');
  });

  it('parses SSH remote', () => {
    expect(parseGithubOwnerRepo('git@github.com:myuser/myrepo.git')).toBe('myuser/myrepo');
  });

  it('parses remote without .git suffix', () => {
    expect(parseGithubOwnerRepo('https://github.com/owner/repo')).toBe('owner/repo');
  });

  it('returns null for non-GitHub remotes', () => {
    expect(parseGithubOwnerRepo('https://gitlab.com/owner/repo.git')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseGithubOwnerRepo('')).toBeNull();
  });
});

describe('resolveOwnerRepo', () => {
  const projectPath = '/path/to/project';

  it('returns parsed owner/repo when remote is a valid GitHub URL', async () => {
    const connectToGitHub = vi.fn();
    const result = await resolveOwnerRepo(
      'https://github.com/owner/repo.git',
      projectPath,
      connectToGitHub
    );
    expect(result).toBe('owner/repo');
    expect(connectToGitHub).not.toHaveBeenCalled();
  });

  it('falls back to connectToGitHub when URL parsing fails', async () => {
    const connectToGitHub = vi
      .fn()
      .mockResolvedValue({ success: true, repository: 'generalaction/emdash' });
    const result = await resolveOwnerRepo(
      'https://gitlab.com/owner/repo.git',
      projectPath,
      connectToGitHub
    );
    expect(connectToGitHub).toHaveBeenCalledWith(projectPath);
    expect(result).toBe('generalaction/emdash');
  });

  it('returns null when both URL parsing and connectToGitHub fail', async () => {
    const connectToGitHub = vi.fn().mockResolvedValue({ success: false });
    const result = await resolveOwnerRepo(
      'https://gitlab.com/owner/repo.git',
      projectPath,
      connectToGitHub
    );
    expect(result).toBeNull();
  });
});

describe('resolveProjectGithubInfo', () => {
  const projectPath = '/path/to/project';
  const githubRemote = 'https://github.com/user/repo.git';
  const sshGithubRemote = 'git@github.com:user/repo.git';
  const nonGithubRemote = 'https://gitlab.com/user/repo.git';

  it('returns connected when authenticated and connectToGitHub succeeds', async () => {
    const connectToGitHub = vi.fn().mockResolvedValue({ success: true, repository: 'user/repo' });

    const result = await resolveProjectGithubInfo(projectPath, githubRemote, true, connectToGitHub);

    expect(connectToGitHub).toHaveBeenCalledWith(projectPath);
    expect(result).toEqual({ connected: true, repository: 'user/repo', source: 'github' });
  });

  it('falls through to local when connectToGitHub fails', async () => {
    const connectToGitHub = vi.fn().mockResolvedValue({ success: false, error: 'Bad credentials' });

    const result = await resolveProjectGithubInfo(projectPath, githubRemote, true, connectToGitHub);

    expect(connectToGitHub).toHaveBeenCalledWith(projectPath);
    expect(result).toEqual({ connected: false, repository: '', source: 'local' });
  });

  it('skips connectToGitHub when not authenticated', async () => {
    const connectToGitHub = vi.fn();

    const result = await resolveProjectGithubInfo(
      projectPath,
      githubRemote,
      false,
      connectToGitHub
    );

    expect(connectToGitHub).not.toHaveBeenCalled();
    expect(result).toEqual({ connected: false, repository: '', source: 'local' });
  });

  it('skips connectToGitHub when remote is not GitHub', async () => {
    const connectToGitHub = vi.fn();

    const result = await resolveProjectGithubInfo(
      projectPath,
      nonGithubRemote,
      true,
      connectToGitHub
    );

    expect(connectToGitHub).not.toHaveBeenCalled();
    expect(result).toEqual({ connected: false, repository: '', source: 'local' });
  });

  it('falls through to local when connectToGitHub throws', async () => {
    const connectToGitHub = vi.fn().mockRejectedValue(new Error('network error'));

    const result = await resolveProjectGithubInfo(projectPath, githubRemote, true, connectToGitHub);

    expect(connectToGitHub).toHaveBeenCalledWith(projectPath);
    expect(result).toEqual({ connected: false, repository: '', source: 'local' });
  });

  it('handles SSH-style GitHub remotes', async () => {
    const connectToGitHub = vi.fn().mockResolvedValue({ success: true, repository: 'user/repo' });

    const result = await resolveProjectGithubInfo(
      projectPath,
      sshGithubRemote,
      true,
      connectToGitHub
    );

    expect(connectToGitHub).toHaveBeenCalledWith(projectPath);
    expect(result).toEqual({ connected: true, repository: 'user/repo', source: 'github' });
  });
});
