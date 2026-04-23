import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runLegacyPort, type LegacyPortStateStore, type LegacyPortStatus } from './service';

function count(db: Database.Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

class OneShotStateStore implements LegacyPortStateStore {
  private status: LegacyPortStatus | null = null;

  async getStatus(): Promise<LegacyPortStatus | null> {
    return this.status;
  }

  async setStatus(status: LegacyPortStatus): Promise<void> {
    this.status = status;
  }

  current(): LegacyPortStatus | null {
    return this.status;
  }
}

describe('manual legacy port verification', () => {
  it('runs once on testRuns db files', async () => {
    const repoRoot = process.cwd();
    const runsDir = process.env.PORT_RUNS_DIR
      ? path.resolve(process.env.PORT_RUNS_DIR)
      : path.join(repoRoot, 'testRuns');
    const appDbPath = path.join(runsDir, 'emdash3.db');
    const legacyDbPath = path.join(runsDir, 'emdash.db');

    if (!fs.existsSync(appDbPath) || !fs.existsSync(legacyDbPath)) {
      return;
    }

    const appDb = new Database(appDbPath);
    const legacyDb = new Database(legacyDbPath, { readonly: true });

    const before = {
      sshConnections: count(appDb, 'ssh_connections'),
      projects: count(appDb, 'projects'),
      tasks: count(appDb, 'tasks'),
      conversations: count(appDb, 'conversations'),
    };

    const legacy = {
      sshConnections: count(legacyDb, 'ssh_connections'),
      projects: count(legacyDb, 'projects'),
      tasks: count(legacyDb, 'tasks'),
      conversations: count(legacyDb, 'conversations'),
      messages: count(legacyDb, 'messages'),
    };

    const stateStore = new OneShotStateStore();

    try {
      await runLegacyPort(runsDir, { appDb, stateStore });

      const after = {
        sshConnections: count(appDb, 'ssh_connections'),
        projects: count(appDb, 'projects'),
        tasks: count(appDb, 'tasks'),
        conversations: count(appDb, 'conversations'),
      };

      const delta = {
        sshConnections: after.sshConnections - before.sshConnections,
        projects: after.projects - before.projects,
        tasks: after.tasks - before.tasks,
        conversations: after.conversations - before.conversations,
      };

      const nullSourceBranchTasks = appDb
        .prepare('SELECT COUNT(*) AS count FROM tasks WHERE source_branch IS NULL')
        .get() as { count: number };

      const result = {
        status: stateStore.current(),
        legacy,
        before,
        after,
        delta,
        tasksWithNullSourceBranch: nullSourceBranchTasks.count,
      };

      fs.writeFileSync(
        path.join(runsDir, 'manual-port-result.json'),
        JSON.stringify(result, null, 2),
        'utf8'
      );

      expect(stateStore.current()).toBe('completed');
    } finally {
      appDb.close();
      legacyDb.close();
    }
  });
});
