import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDb } from '@main/db/client';
import { projects, sshConnections, workspaces } from '@main/db/schema';

const mocks = vi.hoisted(() => ({
  db: undefined as AppDb | undefined,
  deleteAllCredentials: vi.fn(),
  disconnect: vi.fn(),
  getConnectionState: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  get db() {
    if (!mocks.db) throw new Error('Test database not initialized');
    return mocks.db;
  },
}));

vi.mock('./credentials/ssh-credential-service', () => ({
  sshCredentialService: {
    deleteAllCredentials: mocks.deleteAllCredentials,
  },
}));

vi.mock('./lifecycle/production-ssh-connection-manager', () => ({
  sshConnectionManager: {
    disconnect: mocks.disconnect,
    getConnectionState: mocks.getConnectionState,
  },
}));

const { sshOperations: sshController } = await import('./controller');

async function insertSshConnection(db: AppDb): Promise<void> {
  await db.insert(sshConnections).values({
    id: 'ssh-1',
    name: 'Existing SSH',
    host: 'example.com',
    port: 22,
    username: 'jona',
    authType: 'agent',
    useAgent: 1,
  });
}

async function insertRemoteWorkspace(db: AppDb): Promise<void> {
  await db.insert(workspaces).values({
    id: 'workspace-root-1',
    key: 'project-ssh:/repo:ssh-1',
    type: 'project-ssh',
    kind: 'project-root',
    location: 'remote',
    sshConnectionId: 'ssh-1',
    path: '/repo',
  });
}

describe('sshController', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    mocks.db = fixture.db;
    mocks.deleteAllCredentials.mockReset();
    mocks.disconnect.mockReset();
    mocks.getConnectionState.mockReset();
    mocks.getConnectionState.mockReturnValue('disconnected');
  });

  afterEach(() => {
    fixture.close();
    mocks.db = undefined;
  });

  it('rejects duplicate connection names with a user-facing error', async () => {
    await insertSshConnection(fixture.db);

    await expect(
      sshController.saveConnection({
        name: 'Existing SSH',
        host: 'other.example.com',
        port: 22,
        username: 'jona',
        authType: 'agent',
        useAgent: true,
      })
    ).rejects.toThrow(
      'An SSH connection named “Existing SSH” already exists. Choose a different name.'
    );
  });

  it('allows saving an existing connection without renaming it', async () => {
    await insertSshConnection(fixture.db);

    await expect(
      sshController.saveConnection({
        id: 'ssh-1',
        name: 'Existing SSH',
        host: 'example.org',
        port: 22,
        username: 'jona',
        authType: 'agent',
        useAgent: true,
      })
    ).resolves.toMatchObject({ id: 'ssh-1', name: 'Existing SSH', host: 'example.org' });
  });

  it('deletes an unused connection even when an orphan workspace still references it', async () => {
    await insertSshConnection(fixture.db);
    await insertRemoteWorkspace(fixture.db);

    let credentialDeleteSawConnectionRows: number | undefined;
    mocks.deleteAllCredentials.mockImplementation(async (connectionId: string) => {
      const row = fixture.sqlite
        .prepare('SELECT COUNT(*) AS count FROM ssh_connections WHERE id = ?')
        .get(connectionId) as { count: number };
      credentialDeleteSawConnectionRows = row.count;
    });

    await sshController.deleteConnection('ssh-1');

    const remainingConnections = await fixture.db
      .select()
      .from(sshConnections)
      .where(eq(sshConnections.id, 'ssh-1'));
    const [workspace] = await fixture.db
      .select({ sshConnectionId: workspaces.sshConnectionId })
      .from(workspaces)
      .where(eq(workspaces.id, 'workspace-root-1'));

    expect(remainingConnections).toHaveLength(0);
    expect(workspace?.sshConnectionId).toBeNull();
    expect(credentialDeleteSawConnectionRows).toBe(0);
    expect(mocks.deleteAllCredentials).toHaveBeenCalledWith('ssh-1');
  });

  it('does not delete credentials when a project still uses the connection', async () => {
    await insertSshConnection(fixture.db);
    await fixture.db.insert(projects).values({
      id: 'project-1',
      name: 'Blocking Project',
      path: '/repo',
      workspaceProvider: 'ssh',
      sshConnectionId: 'ssh-1',
    });

    await expect(sshController.deleteConnection('ssh-1')).rejects.toThrow(
      'SSH connection is used by Blocking Project'
    );

    const remainingConnections = await fixture.db
      .select()
      .from(sshConnections)
      .where(eq(sshConnections.id, 'ssh-1'));
    expect(remainingConnections).toHaveLength(1);
    expect(mocks.deleteAllCredentials).not.toHaveBeenCalled();
  });
});
