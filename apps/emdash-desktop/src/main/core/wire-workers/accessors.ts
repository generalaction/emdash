import {
  acpClient,
  acpWorker,
  agentConfigClient,
  agentConfigWorker,
  ensureFilesWorkerReady,
  ensureGitWorkerReady,
  filesClient,
  gitClient,
  type AcpRuntimeClient,
  type AgentConfigRuntimeClient,
  type FilesRuntimeClient,
  type GitRuntimeClient,
} from './desktop-workers';

export type {
  AcpRuntimeClient,
  AgentConfigRuntimeClient,
  FilesRuntimeClient,
  GitRuntimeClient,
} from './desktop-workers';

export async function getAcpRuntimeClient(): Promise<AcpRuntimeClient> {
  await acpWorker.ready();
  return acpClient;
}

export async function getAgentConfigRuntimeClient(): Promise<AgentConfigRuntimeClient> {
  await agentConfigWorker.ready();
  return agentConfigClient;
}

export async function getFilesRuntimeClient(): Promise<FilesRuntimeClient> {
  await ensureFilesWorkerReady();
  return filesClient;
}

export async function getGitRuntimeClient(): Promise<GitRuntimeClient> {
  await ensureGitWorkerReady();
  return gitClient;
}
