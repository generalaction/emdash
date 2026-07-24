import { randomUUID } from 'node:crypto';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { HookCore, type Hookable } from '@core/primitives/hooks/api/hookable';
import type { SshConfig, SshConnectionUsage } from '@core/primitives/ssh/api';
import type { AppDb } from '@core/services/app-db/node/db';
import {
  projects,
  sshConnections as sshConnectionsTable,
  type SshConnectionInsert,
} from '@core/services/app-db/node/schema';
import {
  mergeSshConnectionMetadata,
  type SshConnectionMetadata,
  sshConfigFromRow,
} from '@core/services/ssh/node/config/connection-metadata';
import type { SaveMachineInput } from '..';

type MachinesCredentials = {
  storePassword(connectionId: string, password: string): Promise<void>;
  storePassphrase(connectionId: string, passphrase: string): Promise<void>;
  deleteAllCredentials(connectionId: string): Promise<void>;
};

type MachinesSshRuntime = {
  dropConnection(connectionId: string): Promise<void>;
  removeRuntimeState(connectionId: string): void;
};

type MachinesLog = {
  warn(message: string, metadata?: Record<string, unknown>): void;
};

export interface MachinesServiceDeps {
  db: AppDb;
  credentials: MachinesCredentials;
  ssh: MachinesSshRuntime;
  log: MachinesLog;
  createId?: () => string;
  now?: () => number;
}

export type MachineMutationEvent = {
  type: 'saved' | 'deleted';
  connectionId: string;
};

export type MachinesServiceHooks = {
  'machine:mutated': (event: MachineMutationEvent) => void | Promise<void>;
};

export class MachinesService implements Hookable<MachinesServiceHooks> {
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly hooks: HookCore<MachinesServiceHooks>;

  constructor(private readonly deps: MachinesServiceDeps) {
    this.createId = deps.createId ?? randomUUID;
    this.now = deps.now ?? Date.now;
    this.hooks = new HookCore<MachinesServiceHooks>((name, error) => {
      deps.log.warn(`MachinesService: ${String(name)} hook failed`, { error });
    });
  }

  on<K extends keyof MachinesServiceHooks>(name: K, handler: MachinesServiceHooks[K]): () => void {
    return this.hooks.on(name, handler);
  }

  async getMachines(): Promise<SshConfig[]> {
    const rows = await this.deps.db.select().from(sshConnectionsTable);
    return rows.map(sshConfigFromRow);
  }

  async getMachineUsage(): Promise<SshConnectionUsage> {
    const rows = await this.deps.db
      .select({
        id: projects.id,
        name: projects.name,
        sshConnectionId: projects.sshConnectionId,
      })
      .from(projects)
      .where(isNull(projects.deletedAt));

    const usage: SshConnectionUsage = {};
    for (const row of rows) {
      if (!row.sshConnectionId) continue;
      usage[row.sshConnectionId] ??= [];
      usage[row.sshConnectionId].push({ id: row.id, name: row.name });
    }
    return usage;
  }

  async saveMachine(config: SaveMachineInput): Promise<SshConfig> {
    const connectionId = config.id ?? this.createId();
    const existingConnectionWithName = await this.deps.db
      .select({ id: sshConnectionsTable.id })
      .from(sshConnectionsTable)
      .where(
        config.id
          ? and(eq(sshConnectionsTable.name, config.name), ne(sshConnectionsTable.id, connectionId))
          : eq(sshConnectionsTable.name, config.name)
      )
      .limit(1);

    if (existingConnectionWithName.length > 0) {
      throw new Error(
        `An SSH connection named “${config.name}” already exists. Choose a different name.`
      );
    }

    if (config.password) {
      await this.deps.credentials.storePassword(connectionId, config.password);
    }
    if (config.passphrase) {
      await this.deps.credentials.storePassphrase(connectionId, config.passphrase);
    }

    const { password: _password, passphrase: _passphrase, ...dbConfig } = config;

    const existingRows =
      config.id === undefined
        ? []
        : await this.deps.db
            .select({ metadata: sshConnectionsTable.metadata })
            .from(sshConnectionsTable)
            .where(eq(sshConnectionsTable.id, connectionId))
            .limit(1);
    const existingMetadata: SshConnectionMetadata = existingRows[0]?.metadata ?? {};

    const metadataUpdate: SshConnectionMetadata = {};
    if (Object.prototype.hasOwnProperty.call(config, 'sshConfigAlias')) {
      metadataUpdate.sshConfigAlias = config.sshConfigAlias;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'forwardAgent')) {
      metadataUpdate.forwardAgent = config.forwardAgent;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'proxyJump')) {
      metadataUpdate.proxyJump = config.proxyJump;
    }
    const metadata = mergeSshConnectionMetadata(existingMetadata, metadataUpdate);

    const insertData: SshConnectionInsert = {
      id: connectionId,
      name: dbConfig.name,
      host: dbConfig.host,
      port: dbConfig.port,
      metadata,
      username: dbConfig.username,
      authType: dbConfig.authType,
      privateKeyPath: dbConfig.privateKeyPath ?? null,
      useAgent: dbConfig.useAgent ? 1 : 0,
    };

    await this.deps.db
      .insert(sshConnectionsTable)
      .values(insertData)
      .onConflictDoUpdate({
        target: sshConnectionsTable.id,
        set: {
          name: insertData.name,
          host: insertData.host,
          port: insertData.port,
          metadata: insertData.metadata,
          username: insertData.username,
          authType: insertData.authType,
          privateKeyPath: insertData.privateKeyPath,
          useAgent: insertData.useAgent,
          updatedAt: new Date(this.now()).toISOString(),
        },
      });

    if (existingRows.length > 0) {
      await this.deps.ssh.dropConnection(connectionId).catch((error: unknown) => {
        this.deps.log.warn('MachinesService.saveMachine: error disconnecting previous config', {
          connectionId,
          error: String(error),
        });
      });
    }
    this.hooks.callHookBackground('machine:mutated', { type: 'saved', connectionId });

    return {
      ...dbConfig,
      id: connectionId,
      sshConfigAlias: metadata.sshConfigAlias,
      forwardAgent: metadata.forwardAgent,
      proxyJump: metadata.proxyJump,
    };
  }

  async deleteMachine(id: string): Promise<void> {
    const referencingProjects = await this.deps.db
      .select({ name: projects.name })
      .from(projects)
      .where(and(eq(projects.sshConnectionId, id), isNull(projects.deletedAt)));

    if (referencingProjects.length > 0) {
      const projectNames = referencingProjects.map((project) => project.name).join(', ');
      throw new Error(`SSH connection is used by ${projectNames}`);
    }

    await this.deps.ssh.dropConnection(id).catch((error: unknown) => {
      this.deps.log.warn('MachinesService.deleteMachine: error disconnecting', {
        connectionId: id,
        error: String(error),
      });
    });
    await this.deps.db.delete(sshConnectionsTable).where(eq(sshConnectionsTable.id, id));
    try {
      await this.deps.credentials.deleteAllCredentials(id);
    } finally {
      this.deps.ssh.removeRuntimeState(id);
      this.hooks.callHookBackground('machine:mutated', {
        type: 'deleted',
        connectionId: id,
      });
    }
  }

  async renameMachine(id: string, name: string): Promise<void> {
    const [row] = await this.deps.db
      .select()
      .from(sshConnectionsTable)
      .where(eq(sshConnectionsTable.id, id));
    if (!row) throw new Error(`SSH connection ${id} not found`);
    await this.deps.db
      .update(sshConnectionsTable)
      .set({ name, updatedAt: new Date(this.now()).toISOString() })
      .where(eq(sshConnectionsTable.id, id));
  }
}
