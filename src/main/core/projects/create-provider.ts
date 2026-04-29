import type { LocalProject, SshProject } from '@shared/projects';
import { sshConnectionManager } from '@main/core/ssh/ssh-connection-manager';
import { SshFileSystem } from '../fs/impl/ssh-fs';
import { createLocalProvider } from './impl/local-project-provider';
import { createSshProvider } from './impl/ssh-project-provider';

export async function createProvider(project: LocalProject | SshProject) {
  if (project.type === 'ssh') {
    const proxy = await sshConnectionManager.connect(project.connectionId);
    const rootFs = new SshFileSystem(proxy, '/');
    return createSshProvider(project, rootFs, proxy);
  }
  return createLocalProvider(project);
}
