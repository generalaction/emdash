import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import type * as GitLabClientModule from '../../../integrations/impl/gitlab/client';
import { createRepository, deleteRepository, listOwners } from './index';

const gitlab = vi.hoisted(() => ({
  Users: { showCurrentUser: vi.fn() },
  Groups: { all: vi.fn(), show: vi.fn() },
  Namespaces: { show: vi.fn() },
  Projects: { create: vi.fn(), remove: vi.fn() },
}));

vi.mock('../../../integrations/impl/gitlab/client', async (importOriginal) => ({
  ...(await importOriginal<typeof GitLabClientModule>()),
  createGitLabClient: vi.fn(() => gitlab),
}));

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const connected = {
  log,
  credentials: { instanceUrl: 'https://gitlab.example.com/gitlab', apiToken: 'token' },
} as unknown as ConnectedIntegrationHostContext;

beforeEach(() => {
  vi.clearAllMocks();
  gitlab.Users.showCurrentUser.mockResolvedValue({
    username: 'alice',
    namespace_id: 7,
    avatar_url: 'https://gitlab.example.com/alice.png',
  });
  gitlab.Groups.all.mockImplementation(({ minAccessLevel }: { minAccessLevel: number }) => {
    const groups = [
      {
        id: 10,
        full_path: 'acme/platform',
        avatar_url: null,
        project_creation_level: 'developer',
      },
      {
        id: 11,
        full_path: 'acme/ops',
        avatar_url: 'https://gitlab.example.com/ops.png',
        project_creation_level: 'maintainer',
      },
      { id: 12, full_path: 'acme/private', project_creation_level: 'administrator' },
      { id: 13, full_path: 'acme/locked', project_creation_level: 'noone' },
    ];
    return Promise.resolve(groups.filter((group) => minAccessLevel <= (group.id === 10 ? 30 : 40)));
  });
  gitlab.Groups.show.mockResolvedValue({ id: 10 });
  gitlab.Projects.create.mockResolvedValue({
    web_url: 'https://gitlab.example.com/acme/platform/new',
    http_url_to_repo: 'https://gitlab.example.com/acme/platform/new.git',
    ssh_url_to_repo: 'git@gitlab.example.com:acme/platform/new.git',
    path_with_namespace: 'acme/platform/new',
    default_branch: null,
  });
});

describe('GitLab repository plugin', () => {
  it('fails closed on malformed credentials', async () => {
    const host = { log, credentials: {} } as unknown as ConnectedIntegrationHostContext;
    expect((await listOwners(host)).success).toBe(false);
    expect(
      (await createRepository(host, { owner: 'alice', name: 'new', visibility: 'private' })).success
    ).toBe(false);
    expect((await deleteRepository(host, { owner: 'alice', name: 'old' })).success).toBe(false);
    expect(gitlab.Users.showCurrentUser).not.toHaveBeenCalled();
  });

  it('lists the user and nested groups where the token can create projects', async () => {
    await expect(listOwners(connected)).resolves.toEqual({
      success: true,
      data: [
        { login: 'alice', type: 'User', avatarUrl: 'https://gitlab.example.com/alice.png' },
        { login: 'acme/platform', type: 'Organization', avatarUrl: '' },
        {
          login: 'acme/ops',
          type: 'Organization',
          avatarUrl: 'https://gitlab.example.com/ops.png',
        },
      ],
    });
    expect(gitlab.Groups.all).toHaveBeenCalledTimes(2);
  });

  it('reports group listing failures instead of hiding available owners', async () => {
    gitlab.Groups.all.mockRejectedValue(
      Object.assign(new Error('{"message":"Access denied to groups"}'), { status: 403 })
    );
    await expect(listOwners(connected)).resolves.toMatchObject({
      success: false,
      error: { type: 'auth_failed', message: 'Access denied to groups' },
    });
  });

  it('creates in the user namespace', async () => {
    await expect(
      createRepository(connected, { owner: 'alice', name: 'new', visibility: 'private' })
    ).resolves.toEqual({
      success: true,
      data: {
        repositoryUrl: 'https://gitlab.example.com/acme/platform/new',
        cloneUrl: 'https://gitlab.example.com/acme/platform/new.git',
        nameWithOwner: 'acme/platform/new',
        defaultBranch: 'main',
      },
    });
    expect(gitlab.Projects.create).toHaveBeenCalledWith({
      name: 'new',
      description: undefined,
      visibility: 'private',
      namespaceId: 7,
      initializeWithReadme: true,
    });
    expect(gitlab.Groups.show).not.toHaveBeenCalled();
  });

  it('looks up the user namespace when GitLab omits its ID', async () => {
    gitlab.Users.showCurrentUser.mockResolvedValue({ username: 'alice', namespace_id: null });
    gitlab.Namespaces.show.mockResolvedValue({ id: 17 });
    await createRepository(connected, { owner: 'alice', name: 'new', visibility: 'private' });
    expect(gitlab.Namespaces.show).toHaveBeenCalledWith('alice');
    expect(gitlab.Projects.create).toHaveBeenCalledWith(
      expect.objectContaining({ namespaceId: 17 })
    );
  });

  it('resolves a nested group namespace before creating', async () => {
    await createRepository(connected, {
      owner: 'acme/platform',
      name: 'new',
      description: 'A project',
      visibility: 'public',
    });
    expect(gitlab.Groups.show).toHaveBeenCalledWith('acme/platform');
    expect(gitlab.Projects.create).toHaveBeenCalledWith(
      expect.objectContaining({ namespaceId: 10, description: 'A project', visibility: 'public' })
    );
  });

  it('deletes by the full nested path', async () => {
    await expect(
      deleteRepository(connected, { owner: 'acme/platform', name: 'old' })
    ).resolves.toEqual({ success: true, data: undefined });
    expect(gitlab.Projects.remove).toHaveBeenCalledWith('acme/platform/old');
  });

  it('keeps GitLab API messages and typed errors', async () => {
    gitlab.Projects.create.mockRejectedValue(
      Object.assign(new Error('name has already been taken'), { status: 422 })
    );
    await expect(
      createRepository(connected, { owner: 'alice', name: 'new', visibility: 'public' })
    ).resolves.toMatchObject({
      success: false,
      error: { type: 'generic', message: 'name has already been taken' },
    });
    gitlab.Users.showCurrentUser.mockRejectedValue(
      Object.assign(new Error('invalid token'), { status: 401 })
    );
    await expect(listOwners(connected)).resolves.toMatchObject({
      success: false,
      error: { type: 'auth_failed', message: 'invalid token' },
    });
  });

  it('renders GitLab repository name validation as readable text', async () => {
    gitlab.Projects.create.mockRejectedValue(
      new Error('{"name":["can contain only letters, digits, dashes, or spaces"]}')
    );
    await expect(
      createRepository(connected, {
        owner: 'acme/platform',
        name: 'bad/name',
        visibility: 'private',
      })
    ).resolves.toMatchObject({
      success: false,
      error: {
        message: 'Name: can contain only letters, digits, dashes, or spaces',
      },
    });
  });

  it('formats several GitLab validation fields without showing JSON', async () => {
    gitlab.Projects.create.mockRejectedValue(
      new Error(
        '{"message":{"name":["has already been taken"],"path":["is invalid"]},"error":"Could not create project"}'
      )
    );
    await expect(
      createRepository(connected, { owner: 'acme/platform', name: 'bad', visibility: 'private' })
    ).resolves.toMatchObject({
      success: false,
      error: {
        message: 'Name: has already been taken; Path: is invalid; Could not create project',
      },
    });
  });
});
