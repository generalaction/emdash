import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { databaseService } from './DatabaseService';
import { log } from '../lib/logger';

const EXPORT_INTERVAL_MS = 30000; // 30 seconds
const EXPORT_FILE = 'emdash-data.json';

class DataExportService {
  private intervalId: NodeJS.Timeout | null = null;
  private lastExport: string = '';
  private initialized = false;

  async start(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    log.info('DataExportService: starting');
    await this.exportNow();

    this.intervalId = setInterval(async () => {
      await this.exportNow();
    }, EXPORT_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async exportNow(): Promise<void> {
    try {
      const data = await this.gatherData();
      const json = JSON.stringify(data, null, 2);

      if (json === this.lastExport) {
        return;
      }

      const userDataPath = app.getPath('userData');
      const exportPath = join(userDataPath, EXPORT_FILE);

      const dir = userDataPath;
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(exportPath, json, 'utf-8');
      this.lastExport = json;
      log.info('DataExportService: exported data', {
        projects: data.projects.length,
        tasks: data.tasks.length,
        sshConnections: data.sshConnections.length,
      });
    } catch (error) {
      log.error('DataExportService: export failed', { error: String(error) });
    }
  }

  private async gatherData() {
    const projects = await databaseService.getProjects();
    const tasks = await databaseService.getTasks();
    const sshConnections = await databaseService.getSshConnections();

    return {
      exportedAt: new Date().toISOString(),
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        path: p.path,
        isRemote: p.isRemote,
        sshConnectionId: p.sshConnectionId,
        remotePath: p.remotePath,
        gitInfo: p.gitInfo,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
      tasks: tasks.map((t) => ({
        id: t.id,
        projectId: t.projectId,
        name: t.name,
        branch: t.branch,
        path: t.path,
        status: t.status,
        agentId: t.agentId,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
      sshConnections: sshConnections.map((s) => ({
        id: s.id,
        name: s.name,
        host: s.host,
        port: s.port,
        username: s.username,
      })),
    };
  }
}

export const dataExportService = new DataExportService();
