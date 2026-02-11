/**
 * FileSystem Factory
 * Creates appropriate IFileSystem implementation based on project configuration
 */

import { IFileSystem } from './types';
import { LocalFileSystem } from './LocalFileSystem';
import { RemoteFileSystem } from './RemoteFileSystem';
import { SshService } from '../ssh/SshService';
import { ProjectRow } from '../../db/schema';

interface FileSystemCache {
  [key: string]: IFileSystem;
}

export class FileSystemFactory {
  private static cache: FileSystemCache = {};
  private static sshService: SshService | null = null;

  /**
   * Initialize the factory with SSH service
   */
  static initialize(sshService: SshService): void {
    this.sshService = sshService;
  }

  /**
   * Create filesystem for a project
   */
  static create(project: ProjectRow): IFileSystem {
    const cacheKey = project.id;

    // Return cached instance if available
    if (this.cache[cacheKey]) {
      return this.cache[cacheKey];
    }

    let fs: IFileSystem;

    if (project.isRemote && project.sshConnectionId) {
      if (!this.sshService) {
        throw new Error('SSH service not initialized');
      }

      if (!project.remotePath) {
        throw new Error('Remote project missing remotePath');
      }

      fs = new RemoteFileSystem(this.sshService, project.sshConnectionId, project.remotePath);
    } else {
      fs = new LocalFileSystem(project.path);
    }

    // Cache the instance
    this.cache[cacheKey] = fs;
    return fs;
  }

  /**
   * Get filesystem for a project (alias for create)
   */
  static get(project: ProjectRow): IFileSystem {
    return this.create(project);
  }

  /**
   * Clear cache for a specific project
   */
  static clearCache(projectId: string): void {
    delete this.cache[projectId];
  }

  /**
   * Clear all cached filesystems
   */
  static clearAllCache(): void {
    this.cache = {};
  }

  /**
   * Check if project uses remote filesystem
   */
  static isRemote(project: ProjectRow): boolean {
    return !!project.isRemote;
  }

  /**
   * Get connection ID for remote project
   */
  static getConnectionId(project: ProjectRow): string | null {
    return project.sshConnectionId || null;
  }

  /**
   * Dispose factory and clear all resources
   */
  static dispose(): void {
    this.clearAllCache();
    this.sshService = null;
  }
}
