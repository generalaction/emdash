import { execFile } from 'child_process';
import { promisify } from 'util';
import * as crypto from 'crypto';

const execFileAsync = promisify(execFile);

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

  async addRepository(repoPath: string): Promise<Repo> {
    try {
      // Validate that the path is a git repository
      const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: repoPath,
      });

      if (stdout.trim() !== 'true') {
        throw new Error('Not a git repository');
      }

      // Get repository info
      const [origin, defaultBranch] = await Promise.all([
        this.getOrigin(repoPath),
        this.getDefaultBranch(repoPath),
      ]);

      const repo: Repo = {
        id: this.generateId(),
        path: repoPath,
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

  private async getOrigin(repoPath: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
        cwd: repoPath,
      });
      return stdout.trim();
    } catch {
      return 'No origin';
    }
  }

  private async getDefaultBranch(repoPath: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
        cwd: repoPath,
      });
      const ref = stdout.trim();
      const prefix = 'refs/remotes/origin/';
      return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref || 'main';
    } catch {
      return 'main';
    }
  }

  private generateId(): string {
    return crypto.randomUUID();
  }

  getRepository(id: string): Repo | undefined {
    return this.repos.get(id);
  }

  getAllRepositories(): Repo[] {
    return Array.from(this.repos.values());
  }
}
