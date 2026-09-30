import { generateKeyPairSync } from 'node:crypto';
import { secret } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { utils } from 'ssh2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MachinesService } from '@core/features/machines/api/node/machines-service';
import { captureMachineSave } from '@core/features/machines/node/machine-persistence';
import type { SshConfig } from '@core/primitives/ssh/api';
import { appSecrets, sshConnections } from '@core/services/app-db/node/schema';
import { resolveSshConnectConfig } from '@core/services/ssh/node/connect/resolve-ssh-connect-config';
import {
  sshCredentialChanges,
  sshCredentialKeys,
} from '@core/services/ssh/node/credentials/credential-record';
import { SshCredentialService } from '@core/services/ssh/node/credentials/ssh-credential-service';
import { EncryptedAppSecretsStore } from '@main/host/secrets/encrypted-app-secrets-store';

vi.mock('electron', () => ({ safeStorage: undefined }));

describe('atomic, identity-bound machine credentials', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let store: EncryptedAppSecretsStore;
  let credentials: SshCredentialService;
  let service: MachinesService;
  let beforeCommit: (() => void) | undefined;
  const encrypt = vi.fn((value: string) => Buffer.from(`encrypted:${value}`));
  const dropConnection = vi.fn(async () => {});
  const readFile = vi.fn(async (path: string) => `key contents at ${path}`);
  const resolveSshConfig = vi.fn(async () => ({
    hostname: 'work.internal',
    user: 'alice',
    port: 22,
    identityFile: ['/keys/old'],
    identityAgentDisabled: false,
    identitiesOnly: false,
    forwardAgent: false,
  }));
  const original: SshConfig = {
    id: 'one',
    name: 'Work',
    host: 'work.internal',
    port: 22,
    username: 'alice',
    authType: 'password',
  };

  beforeEach(async () => {
    fixture = await openFixture('empty');
    beforeCommit = undefined;
    encrypt.mockClear();
    dropConnection.mockClear();
    readFile.mockReset().mockImplementation(async (path) => `key contents at ${path}`);
    resolveSshConfig.mockReset().mockResolvedValue({
      hostname: original.host,
      user: original.username,
      port: original.port,
      identityFile: ['/keys/old'],
      identityAgentDisabled: false,
      identitiesOnly: false,
      forwardAgent: false,
    });
    store = new EncryptedAppSecretsStore(
      fixture.db,
      {
        isEncryptionAvailable: () => true,
        encryptString: encrypt,
        decryptString: (value: Buffer) => value.toString().slice('encrypted:'.length),
      } as unknown as Electron.SafeStorage,
      'darwin'
    );
    credentials = new SshCredentialService(store);
    service = new MachinesService({
      db: fixture.db,
      credentials,
      readFile,
      resolveSshConfig,
      now: () => 0,
      prepareCredentials: (id, values) => {
        const apply = store.prepareChanges(sshCredentialChanges(id, values));
        beforeCommit?.();
        return apply;
      },
      ssh: { dropConnection, removeRuntimeState: vi.fn() },
      log: { warn: vi.fn() },
    });
  });

  afterEach(() => fixture.close());

  const connectDeps = () => ({
    readFile,
    resolveSshConfig,
    getPassword: credentials.getPassword.bind(credentials),
    getPassphrase: credentials.getPassphrase.bind(credentials),
  });

  it.each(['manual', 'config'] as const)(
    'preserves a legacy passphrase until explicit re-entry for %s connections',
    async (mode) => {
      const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: {
          type: 'pkcs1',
          format: 'pem',
          cipher: 'aes-256-cbc',
          passphrase: 'legacy-passphrase',
        },
      });
      expect(utils.parseKey(privateKey, 'legacy-passphrase')).not.toBeInstanceOf(Error);
      readFile.mockResolvedValue(privateKey);
      const config = {
        ...original,
        authType: 'key' as const,
        privateKeyPath: mode === 'manual' ? '/keys/unchanged' : undefined,
        sshConfigAlias: mode === 'config' ? 'work' : undefined,
      };
      fixture.db
        .insert(sshConnections)
        .values({ ...config, useAgent: 0, metadata: { sshConfigAlias: config.sshConfigAlias } })
        .run();
      await credentials.storePassphrase(config.id, secret('legacy-passphrase'));
      const before = captureMachineSave(fixture.db, config.id);
      const draft = { ...config, name: 'Only renamed', passphrase: '' };
      await expect(service.saveMachine(draft)).rejects.toThrow('Re-enter your SSH key passphrase');
      await expect(
        resolveSshConnectConfig(
          { kind: 'transient', config: draft, previous: config },
          connectDeps()
        )
      ).rejects.toThrow('Re-enter your SSH key passphrase');
      await expect(
        resolveSshConnectConfig({ kind: 'persisted', row: before.connection! }, connectDeps())
      ).rejects.toThrow('Re-enter your SSH key passphrase');
      expect(captureMachineSave(fixture.db, config.id)).toEqual(before);
      expect(dropConnection).not.toHaveBeenCalled();

      await service.saveMachine({ ...draft, passphrase: 'legacy-passphrase' });
      expect(await store.getSecret(sshCredentialKeys(config.id).passphrase)).toBeNull();
      const row = captureMachineSave(fixture.db, config.id).connection!;
      const result = await resolveSshConnectConfig({ kind: 'persisted', row }, connectDeps());
      expect(
        utils.parseKey(result.config.privateKey!, result.config.passphrase)
      ).not.toBeInstanceOf(Error);
      await service.saveMachine({ ...draft, name: 'Renamed again' });
      expect(
        (await resolveSshConnectConfig({ kind: 'persisted', row }, connectDeps())).config.passphrase
      ).toBe('legacy-passphrase');
    }
  );

  it('preserves the old row and secrets when another writer claims the name after the pre-check', async () => {
    await service.saveMachine({ ...original, password: 'original password' });
    const before = captureMachineSave(fixture.db, original.id);
    beforeCommit = () => {
      fixture.db
        .insert(sshConnections)
        .values({ ...original, id: 'other', name: 'Contended', useAgent: 0 })
        .run();
    };
    await expect(
      service.saveMachine({
        ...original,
        name: 'Contended',
        host: 'new.internal',
        password: 'replacement',
      })
    ).rejects.toThrow('UNIQUE constraint failed');
    expect(captureMachineSave(fixture.db, original.id)).toEqual(before);
    expect(dropConnection).not.toHaveBeenCalled();
  });

  it.each(['replace', 'delete'] as const)(
    'rolls back the row and secrets when credential %s fails',
    async (operation) => {
      await service.saveMachine({ ...original, password: 'original password' });
      const before = captureMachineSave(fixture.db, original.id);
      fixture.sqlite
        .exec(`CREATE TRIGGER fail_secret BEFORE ${operation === 'replace' ? 'INSERT' : 'DELETE'} ON app_secrets
      BEGIN SELECT RAISE(ABORT, 'credential write failed'); END`);
      await expect(
        service.saveMachine({
          ...original,
          name: 'Changed',
          authType: operation === 'replace' ? 'password' : 'agent',
          password: 'replacement',
        })
      ).rejects.toThrow('credential write failed');
      expect(captureMachineSave(fixture.db, original.id)).toEqual(before);
      expect(dropConnection).not.toHaveBeenCalled();
    }
  );

  it('does not change storage if encryption fails', async () => {
    await service.saveMachine({ ...original, password: 'original password' });
    const before = captureMachineSave(fixture.db, original.id);
    encrypt.mockImplementationOnce(() => {
      throw new Error('encryption unavailable');
    });
    await expect(service.saveMachine({ ...original, password: 'replacement' })).rejects.toThrow(
      'encryption unavailable'
    );
    expect(captureMachineSave(fixture.db, original.id)).toEqual(before);
  });

  it('rejects a concurrent stale save even when only the credential changed', async () => {
    await service.saveMachine({ ...original, password: 'original password' });
    // Keep timestamps equal, so the credential snapshot must catch this conflict.
    await service.saveMachine({ ...original, password: 'original password' });
    const started = deferred();
    const resume = deferred();
    const getPassword = credentials.getPassword.bind(credentials);
    vi.spyOn(credentials, 'getPassword').mockImplementationOnce(async (id, identity) => {
      const value = await getPassword(id, identity);
      started.resolve();
      await resume.promise;
      return value;
    });
    const pending = service.saveMachine({ ...original, password: '' });
    const rejected = expect(pending).rejects.toThrow('changed while saving');
    await started.promise;
    await service.saveMachine({ ...original, password: 'winning password' });
    resume.resolve();
    await rejected;
    const result = await resolveSshConnectConfig(
      { kind: 'transient', config: original, previous: original },
      connectDeps()
    );
    expect(result.config.password).toBe('winning password');
  });

  it.each(['path', 'contents'] as const)(
    'does not reuse the inherited passphrase after key %s changes',
    async (change) => {
      const config = { ...original, authType: 'key' as const, sshConfigAlias: 'work' };
      await service.saveMachine({ ...config, passphrase: 'old key passphrase' });
      const input = { kind: 'transient' as const, config, previous: config };
      expect((await resolveSshConnectConfig(input, connectDeps())).config.passphrase).toBe(
        'old key passphrase'
      );
      if (change === 'path')
        resolveSshConfig.mockResolvedValue({
          ...(await resolveSshConfig()),
          identityFile: ['/keys/new'],
        });
      else readFile.mockResolvedValue('replacement contents at the same path');
      expect(
        (await resolveSshConnectConfig(input, connectDeps())).config.passphrase
      ).toBeUndefined();
      const row = fixture.db
        .select()
        .from(sshConnections)
        .where(eq(sshConnections.id, original.id))
        .get()!;
      expect(
        (await resolveSshConnectConfig({ kind: 'persisted', row }, connectDeps())).config.passphrase
      ).toBeUndefined();
      await service.saveMachine(config);
      expect(await store.getSecret(sshCredentialKeys(config.id).boundPassphrase)).toBeNull();
      await service.saveMachine({ ...config, passphrase: 'replacement passphrase' });
      expect((await resolveSshConnectConfig(input, connectDeps())).config.passphrase).toBe(
        'replacement passphrase'
      );
    }
  );

  it.each([{ hostname: 'new.internal' }, { user: 'other' }, { port: 2222 }])(
    'rejects effective destination drift on save, test, and reconnect: %j',
    async (change) => {
      const config = { ...original, sshConfigAlias: 'work' };
      await service.saveMachine({ ...config, password: 'original password' });
      const before = captureMachineSave(fixture.db, original.id);
      resolveSshConfig.mockResolvedValue({ ...(await resolveSshConfig()), ...change });
      const getPassword = vi.spyOn(credentials, 'getPassword');
      for (const password of ['', 'newly entered password']) {
        await expect(service.saveMachine({ ...config, password })).rejects.toThrow(
          'SSH config changed'
        );
        await expect(
          resolveSshConnectConfig(
            { kind: 'transient', config: { ...config, password }, previous: config },
            connectDeps()
          )
        ).rejects.toThrow('SSH config changed');
      }
      await expect(
        resolveSshConnectConfig({ kind: 'persisted', row: before.connection! }, connectDeps())
      ).rejects.toThrow('SSH config changed');
      expect(getPassword).not.toHaveBeenCalled();
      expect(captureMachineSave(fixture.db, original.id)).toEqual(before);
    }
  );

  it('does not combine an old connection snapshot with a newly saved destination password', async () => {
    await service.saveMachine({ ...original, password: 'old password' });
    const row = captureMachineSave(fixture.db, original.id).connection!;
    await service.saveMachine({
      ...original,
      host: 'replacement.internal',
      password: 'new password',
    });
    await expect(
      resolveSshConnectConfig({ kind: 'persisted', row }, connectDeps())
    ).rejects.toThrow('Enter a password');
  });

  it('upgrades a compatible legacy password but does not guess a legacy passphrase binding', async () => {
    fixture.db
      .insert(sshConnections)
      .values({ ...original, useAgent: 0 })
      .run();
    await credentials.storePassword(original.id, secret('legacy password'));
    await service.saveMachine(original);
    expect(await store.getSecret(sshCredentialKeys(original.id).password)).toBeNull();
    expect(
      (
        await resolveSshConnectConfig(
          { kind: 'transient', config: original, previous: original },
          connectDeps()
        )
      ).config.password
    ).toBe('legacy password');
    await credentials.storePassphrase(original.id, secret('unbound passphrase'));
    await expect(credentials.getPassphrase(original.id, 'unknown-key')).rejects.toThrow(
      'Re-enter your SSH key passphrase'
    );
    const rows = fixture.db.select().from(appSecrets).all();
    expect(rows.every((row) => !row.secret.includes('legacy password'))).toBe(true);
  });
});
