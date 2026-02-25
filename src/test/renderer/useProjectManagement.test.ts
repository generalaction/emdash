import { describe, expect, it, vi } from 'vitest';
import { resolveProjectGithubInfo } from '../../renderer/lib/projectUtils';

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
