import {
  getAcpRuntimeClient as getReadyAcpRuntimeClient,
  getAgentConfigRuntimeClient as getReadyAgentConfigRuntimeClient,
  getFilesRuntimeClient as getReadyFilesRuntimeClient,
  getGitRuntimeClient as getReadyGitRuntimeClient,
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
  return await getReadyAcpRuntimeClient();
}

export async function getAgentConfigRuntimeClient(): Promise<AgentConfigRuntimeClient> {
  return await getReadyAgentConfigRuntimeClient();
}

export async function getFilesRuntimeClient(): Promise<FilesRuntimeClient> {
  return await getReadyFilesRuntimeClient();
}

export async function getGitRuntimeClient(): Promise<GitRuntimeClient> {
  return await getReadyGitRuntimeClient();
}
