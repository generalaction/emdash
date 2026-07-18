import {
  getAcpRuntimeClient as getReadyAcpRuntimeClient,
  getAgentConfigRuntimeClient as getReadyAgentConfigRuntimeClient,
  getAutomationsRuntimeClient as getReadyAutomationsRuntimeClient,
  getFileSearchRuntimeClient as getReadyFileSearchRuntimeClient,
  getFilesRuntimeClient as getReadyFilesRuntimeClient,
  getGitRuntimeClient as getReadyGitRuntimeClient,
  getTerminalsRuntimeClient as getReadyTerminalsRuntimeClient,
  getTuiAgentsRuntimeClient as getReadyTuiAgentsRuntimeClient,
  getWorkspaceRuntimeClient as getReadyWorkspaceRuntimeClient,
  type AcpRuntimeClient,
  type AgentConfigRuntimeClient,
  type AutomationsRuntimeClient,
  type FileSearchRuntimeClient,
  type FilesRuntimeClient,
  type GitRuntimeClient,
  type TerminalsRuntimeClient,
  type TuiAgentsRuntimeClient,
  type WorkspaceRuntimeClient,
} from './desktop-workers';

export type {
  AcpRuntimeClient,
  AgentConfigRuntimeClient,
  AutomationsRuntimeClient,
  FileSearchRuntimeClient,
  FilesRuntimeClient,
  GitRuntimeClient,
  TerminalsRuntimeClient,
  TuiAgentsRuntimeClient,
  WorkspaceRuntimeClient,
} from './desktop-workers';

export async function getAcpRuntimeClient(): Promise<AcpRuntimeClient> {
  return await getReadyAcpRuntimeClient();
}

export async function getAgentConfigRuntimeClient(): Promise<AgentConfigRuntimeClient> {
  return await getReadyAgentConfigRuntimeClient();
}

export async function getAutomationsRuntimeClient(): Promise<AutomationsRuntimeClient> {
  return await getReadyAutomationsRuntimeClient();
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

export async function getTerminalsRuntimeClient(): Promise<TerminalsRuntimeClient> {
  return await getReadyTerminalsRuntimeClient();
}

export async function getWorkspaceRuntimeClient(): Promise<WorkspaceRuntimeClient> {
  return await getReadyWorkspaceRuntimeClient();
}
