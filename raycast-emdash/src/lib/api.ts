import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, statSync } from 'fs';
import type { Project, Task, SshConnection } from './types';

function getExportPath(): string {
  return join(homedir(), 'Library', 'Application Support', 'emdash', 'emdash-data.json');
}

interface ExportData {
  exportedAt: string;
  projects: Project[];
  tasks: Task[];
  sshConnections: SshConnection[];
}

class EmdashApi {
  private cache: ExportData | null = null;
  private lastModified = 0;

  private async loadData(): Promise<ExportData> {
    const exportPath = getExportPath();

    if (!existsSync(exportPath)) {
      throw new Error('Emdash data not found. Please open Emdash first.');
    }

    const stats = statSync(exportPath);
    const mtime = stats.mtimeMs;

    if (!this.cache || mtime > this.lastModified) {
      const content = readFileSync(exportPath, 'utf-8');
      this.cache = JSON.parse(content);
      this.lastModified = mtime;
    }

    return this.cache!;
  }

  async getProjects(): Promise<Project[]> {
    try {
      const data = await this.loadData();
      return data.projects;
    } catch (e) {
      console.error('getProjects error:', e);
      throw e;
    }
  }

  async getRecentProjects(): Promise<Project[]> {
    const data = await this.loadData();
    return [...data.projects]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 10);
  }

  async getProjectById(id: string): Promise<Project | null> {
    const data = await this.loadData();
    return data.projects.find((p) => p.id === id) || null;
  }

  async getTasks(projectId?: string): Promise<Task[]> {
    const data = await this.loadData();
    if (projectId) {
      return data.tasks.filter((t) => t.projectId === projectId && !t.archivedAt);
    }
    return data.tasks.filter((t) => !t.archivedAt);
  }

  async getSshConnections(): Promise<SshConnection[]> {
    const data = await this.loadData();
    return data.sshConnections;
  }
}

export const emdashApi = new EmdashApi();
