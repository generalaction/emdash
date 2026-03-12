import type { LocalProject, SshProject } from '@shared/projects/types';
import { sshConnectionManager } from '@main/core/ssh/ssh-connection-manager';
import { log } from '@main/lib/logger';
import { LocalProjectProvider } from './local-project-provider';
import type { ProjectProvider } from './project-provider';
import { SshProjectProvider } from './ssh-project-provider';

export function createLocalProvider(project: LocalProject): LocalProjectProvider {
  return new LocalProjectProvider(project);
}

export async function createSshProvider(project: SshProject): Promise<SshProjectProvider> {
  try {
    const proxy = await sshConnectionManager.connect(project.connectionId);
    return new SshProjectProvider(project.id, project.connectionId, proxy);
  } catch (error) {
    log.warn('createSshProvider: SSH connection failed', {
      projectId: project.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function createProvider(project: LocalProject | SshProject): Promise<ProjectProvider> {
  if (project.type === 'ssh') {
    return createSshProvider(project);
  }
  return createLocalProvider(project);
}
