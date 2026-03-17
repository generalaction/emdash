import { describe, expect, it, vi } from 'vitest';
import { parseGithubOwnerRepo, resolveProjectGithubInfo } from '../../renderer/lib/projectUtils';

// ---------------------------------------------------------------------------
// Staleness guard simulation
// Mirrors the logic in the useEffect in useProjectManagement that re-syncs
// githubInfo.repository on project selection.
// ---------------------------------------------------------------------------
async function syncGithubOwnerRepo({
  activeProjectIdRef,
  originProjectId,
  getGitInfo,
  connectToGitHub,
  currentRepository,
  saveProject,
  setSelectedProject,
}: {
  activeProjectIdRef: { current: string | null };
  originProjectId: string;
  getGitInfo: () => Promise<{ remote: string }>;
  connectToGitHub: () => Promise<{ success: boolean; repository?: string }>;
  currentRepository: string | undefined;
  saveProject: (repo: string) => Promise<void>;
  setSelectedProject: (repo: string) => void;
}) {
  const gitInfo = await getGitInfo();
  let ownerRepo = parseGithubOwnerRepo(gitInfo.remote || '');
  if (!ownerRepo) {
    const result = await connectToGitHub();
    if (result.success && result.repository) ownerRepo = result.repository;
  }
  if (activeProjectIdRef.current !== originProjectId) return;
  if (!ownerRepo || ownerRepo === currentRepository) return;
  await saveProject(ownerRepo);
  if (activeProjectIdRef.current !== originProjectId) return;
  setSelectedProject(ownerRepo);
}

describe('syncGithubOwnerRepo staleness guard', () => {
  it('updates project when owner/repo changes and project is still active', async () => {
    const activeProjectIdRef = { current: 'project-a' };
    const saveProject = vi.fn().mockResolvedValue(undefined);
    const setSelectedProject = vi.fn();

    await syncGithubOwnerRepo({
      activeProjectIdRef,
      originProjectId: 'project-a',
      getGitInfo: vi.fn().mockResolvedValue({ remote: 'https://github.com/owner/new-repo.git' }),
      connectToGitHub: vi.fn(),
      currentRepository: 'owner/old-repo',
      saveProject,
      setSelectedProject,
    });

    expect(saveProject).toHaveBeenCalledWith('owner/new-repo');
    expect(setSelectedProject).toHaveBeenCalledWith('owner/new-repo');
  });

  it('does not update state when project switches before getGitInfo resolves', async () => {
    const activeProjectIdRef = { current: 'project-a' };
    const saveProject = vi.fn();
    const setSelectedProject = vi.fn();

    await syncGithubOwnerRepo({
      activeProjectIdRef,
      originProjectId: 'project-b', // stale — user already switched away from B
      getGitInfo: vi.fn().mockResolvedValue({ remote: 'https://github.com/owner/repo.git' }),
      connectToGitHub: vi.fn(),
      currentRepository: undefined,
      saveProject,
      setSelectedProject,
    });

    expect(saveProject).not.toHaveBeenCalled();
    expect(setSelectedProject).not.toHaveBeenCalled();
  });

  it('does not call setSelectedProject when project switches between saveProject and state update', async () => {
    const activeProjectIdRef = { current: 'project-a' };
    const setSelectedProject = vi.fn();

    await syncGithubOwnerRepo({
      activeProjectIdRef,
      originProjectId: 'project-a',
      getGitInfo: vi.fn().mockResolvedValue({ remote: 'https://github.com/owner/repo.git' }),
      connectToGitHub: vi.fn(),
      currentRepository: 'owner/old-repo',
      saveProject: vi.fn().mockImplementation(async () => {
        // Simulate project switch happening during DB save
        activeProjectIdRef.current = 'project-b';
      }),
      setSelectedProject,
    });

    expect(setSelectedProject).not.toHaveBeenCalled();
  });

  it('skips update when resolved owner/repo matches stored value', async () => {
    const activeProjectIdRef = { current: 'project-a' };
    const saveProject = vi.fn();
    const setSelectedProject = vi.fn();

    await syncGithubOwnerRepo({
      activeProjectIdRef,
      originProjectId: 'project-a',
      getGitInfo: vi.fn().mockResolvedValue({ remote: 'https://github.com/owner/repo.git' }),
      connectToGitHub: vi.fn(),
      currentRepository: 'owner/repo', // already up to date
      saveProject,
      setSelectedProject,
    });

    expect(saveProject).not.toHaveBeenCalled();
    expect(setSelectedProject).not.toHaveBeenCalled();
  });
});

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
