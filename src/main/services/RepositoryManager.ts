import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';

const execAsync = promisify(exec);

export interface Repo {
  id: string;
  path: string;
  origin: string;
  defaultBranch: string;
  lastActivity?: string;
  changes?: {
    added: number;
    removed: number;
  };
}

export class RepositoryManager {
  private repos: Map<string, Repo> = new Map();

  async scanRepositories(): Promise<Repo[]> {
    // Need to implement actual repository scanning
    // For now, return empty array
    return [];
  }

  async addRepository(path: string): Promise<Repo> {
    try {
      // Validate that the path is a git repository
      const { stdout } = await execAsync(`cd "${path}" && git rev-parse --is-inside-work-tree`);

      if (stdout.trim() !== 'true') {
        throw new Error('Not a git repository');
      }

      // Get repository info
      const [origin, defaultBranch] = await Promise.all([
        this.getOrigin(path),
        this.getDefaultBranch(path),
      ]);

      const repo: Repo = {
        id: this.generateId(),
        path,
        origin,
        defaultBranch,
        lastActivity: new Date().toISOString(),
      };

      this.repos.set(repo.id, repo);
      return repo;
    } catch (error) {
      throw new Error(`Failed to add repository: ${error}`);
    }
  }

  private async getOrigin(path: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`cd "${path}" && git remote get-url origin`);
      return stdout.trim();
    } catch {
      return 'No origin';
    }
  }

  private async getDefaultBranch(path: string): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `cd "${path}" && git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@'`
      );
      return stdout.trim() || 'main';
    } catch {
      return 'main';
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  getRepository(id: string): Repo | undefined {
    return this.repos.get(id);
  }

  getAllRepositories(): Repo[] {
    return Array.from(this.repos.values());
  }
}
