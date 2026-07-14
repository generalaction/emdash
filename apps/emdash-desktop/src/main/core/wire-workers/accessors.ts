import {
  getAcpRuntimeClient as getReadyAcpRuntimeClient,
  getAgentConfigRuntimeClient as getReadyAgentConfigRuntimeClient,
  getFileSearchRuntimeClient as getReadyFileSearchRuntimeClient,
  getFilesRuntimeClient as getReadyFilesRuntimeClient,
  getGitRuntimeClient as getReadyGitRuntimeClient,
  getTuiAgentsRuntimeClient as getReadyTuiAgentsRuntimeClient,
  type AcpRuntimeClient,
  type AgentConfigRuntimeClient,
  type FileSearchRuntimeClient,
  type FilesRuntimeClient,
  type GitRuntimeClient,
  type TuiAgentsRuntimeClient,
} from './desktop-workers';

export type {
  AcpRuntimeClient,
  AgentConfigRuntimeClient,
  FileSearchRuntimeClient,
  FilesRuntimeClient,
  GitRuntimeClient,
  TuiAgentsRuntimeClient,
} from './desktop-workers';

export async function getAcpRuntimeClient(): Promise<AcpRuntimeClient> {
  return await getReadyAcpRuntimeClient();
}

export async function getAgentConfigRuntimeClient(): Promise<AgentConfigRuntimeClient> {
  return await getReadyAgentConfigRuntimeClient();
}

export async function getFileSearchRuntimeClient(): Promise<FileSearchRuntimeClient> {
  return await getReadyFileSearchRuntimeClient();
}

export async function getFilesRuntimeClient(): Promise<FilesRuntimeClient> {
  return await getReadyFilesRuntimeClient();
}

export async function getGitRuntimeClient(): Promise<GitRuntimeClient> {
  return await getReadyGitRuntimeClient();
}

export async function getTuiAgentsRuntimeClient(): Promise<TuiAgentsRuntimeClient> {
  return await getReadyTuiAgentsRuntimeClient();
}
