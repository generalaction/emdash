import { join } from 'node:path';
import { app } from 'electron';
import type {
  ResolveStartupDataGateActionArgs,
  ResolveStartupDataGateActionResult,
  StartupDataGateAction,
  StartupDataGateScenario,
  StartupDataGateState,
} from '@shared/startup-data-gate';
import { emdashAccountService } from '@main/core/account/services/emdash-account-service';
import { sqlite } from '@main/db/client';
import {
  createDefaultLegacyPortStateStore,
  hasLegacyFile,
  runLegacyPort,
  type LegacyPortStateStore,
} from '@main/db/legacy-port/service';
import { log } from '@main/lib/logger';

const BETA_DATA_TABLES = ['projects', 'tasks', 'conversations', 'ssh_connections'] as const;
const BETA_WIPE_TABLES = [
  'messages',
  'terminals',
  'line_comments',
  'editor_buffers',
  'tasks_pull_requests',
  'project_pull_requests',
  'pull_request_assignees',
  'pull_request_labels',
  'conversations',
  'tasks',
  'pull_requests',
  'projects',
  'ssh_connections',
  'app_settings',
  'app_secrets',
  'kv',
] as const;

function resolveScenario(hasLegacy: boolean, hasBetaData: boolean): StartupDataGateScenario {
  if (hasLegacy && hasBetaData) return 'both';
  if (hasLegacy) return 'legacy_only';
  if (hasBetaData) return 'beta_only';
  return 'none';
}

function allowedActionsForScenario(scenario: StartupDataGateScenario): StartupDataGateAction[] {
  if (scenario === 'legacy_only') return ['import_legacy', 'skip_legacy'];
  if (scenario === 'beta_only') return ['keep_beta', 'wipe_beta'];
  if (scenario === 'both') return ['keep_beta', 'replace_with_legacy', 'wipe_beta'];
  return [];
}

class StartupDataGateService {
  private actionPromise: Promise<void> | null = null;
  private stateStorePromise: Promise<LegacyPortStateStore> | null = null;

  private async getStateStore(): Promise<LegacyPortStateStore> {
    if (!this.stateStorePromise) {
      this.stateStorePromise = createDefaultLegacyPortStateStore();
    }
    return this.stateStorePromise;
  }

  private hasBetaData(): boolean {
    for (const tableName of BETA_DATA_TABLES) {
      const existing = sqlite.prepare(`SELECT 1 FROM ${tableName} LIMIT 1`).get();
      if (existing) return true;
    }
    return false;
  }

  private wipeBetaData(): void {
    const wipeTransaction = sqlite.transaction(() => {
      for (const tableName of BETA_WIPE_TABLES) {
        sqlite.prepare(`DELETE FROM ${tableName}`).run();
      }
    });
    wipeTransaction();
  }

  private createBetaBackup(userDataPath: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(userDataPath, `emdash3.backup-${timestamp}.db`);
    const escapedBackupPath = backupPath.replace(/'/g, "''");
    sqlite.exec(`VACUUM INTO '${escapedBackupPath}'`);
    return backupPath;
  }

  private async resolveState(): Promise<StartupDataGateState> {
    const userDataPath = app.getPath('userData');
    const hasDetectedLegacyFile = hasLegacyFile(userDataPath);
    const hasDetectedBetaData = this.hasBetaData();
    const scenario = resolveScenario(hasDetectedLegacyFile, hasDetectedBetaData);
    const status = await (await this.getStateStore()).getStatus();

    if (status) {
      return {
        phase: 'ready',
        scenario,
        hasLegacyFile: hasDetectedLegacyFile,
        hasBetaData: hasDetectedBetaData,
        status,
      };
    }

    if (this.actionPromise) {
      return {
        phase: 'running',
        scenario,
        hasLegacyFile: hasDetectedLegacyFile,
        hasBetaData: hasDetectedBetaData,
        status: null,
      };
    }

    return {
      phase: scenario === 'none' ? 'ready' : 'needs_decision',
      scenario,
      hasLegacyFile: hasDetectedLegacyFile,
      hasBetaData: hasDetectedBetaData,
      status: null,
    };
  }

  private async runAction(action: StartupDataGateAction): Promise<void> {
    const stateStore = await this.getStateStore();
    const userDataPath = app.getPath('userData');
    const scenario = resolveScenario(hasLegacyFile(userDataPath), this.hasBetaData());
    const allowedActions = allowedActionsForScenario(scenario);

    if (!allowedActions.includes(action)) {
      throw new Error(`Action "${action}" is not available for scenario "${scenario}".`);
    }

    if (action === 'keep_beta') {
      await stateStore.setStatus('kept-beta');
      return;
    }

    if (action === 'skip_legacy') {
      await stateStore.setStatus('skipped-legacy');
      return;
    }

    if (action === 'wipe_beta') {
      const backupPath = this.createBetaBackup(userDataPath);
      log.info('legacy-port: created beta backup before wipe', { backupPath });
      this.wipeBetaData();
      await stateStore.setStatus('wiped-beta');
      return;
    }

    if (action === 'replace_with_legacy') {
      const backupPath = this.createBetaBackup(userDataPath);
      log.info('legacy-port: created beta backup before replace', { backupPath });
      this.wipeBetaData();
    }

    await runLegacyPort(userDataPath, { stateStore });
    await emdashAccountService.loadSessionToken();
  }

  async getState(): Promise<StartupDataGateState> {
    return this.resolveState();
  }

  async resolveAction(
    args: ResolveStartupDataGateActionArgs
  ): Promise<ResolveStartupDataGateActionResult> {
    try {
      if (!this.actionPromise) {
        this.actionPromise = this.runAction(args.action).finally(() => {
          this.actionPromise = null;
        });
      }
      await this.actionPromise;

      const state = await this.resolveState();
      if (state.phase !== 'ready') {
        return {
          success: false,
          state,
          error: 'Startup selection did not complete. Check logs and try again.',
        };
      }

      return { success: true, state };
    } catch (error) {
      const state = await this.resolveState();
      return {
        success: false,
        state,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export const startupDataGateService = new StartupDataGateService();
