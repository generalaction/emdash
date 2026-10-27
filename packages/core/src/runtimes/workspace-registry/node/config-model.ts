import path from 'node:path';
import {
  AGENT_CONFIG_FILE,
  parseAgentConfig,
  type AgentConfig,
} from '#primitives/agent-config/api';
import { readConfigFile } from '#services/config-model/node';

/**
 * One workspace's parsed `.agent.json` in the registry's live config model
 * (spec: workspace-lifecycle-v2, config live model). Entries are read off the
 * blocking path — at boot, at creation finalize/adoption, and on scans — so
 * creation and activation verbs never touch the file on disk.
 */
export type WorkspaceConfigEntry = {
  config: AgentConfig;
  /** True when the file existed but did not parse; the empty default applied. */
  parseError: boolean;
};

/** A missing file is the empty config — only a present-but-broken file is an error. */
export async function readWorkspaceConfig(workspacePath: string): Promise<WorkspaceConfigEntry> {
  const entry = await readConfigFile(path.join(workspacePath, AGENT_CONFIG_FILE), parseAgentConfig);
  return { config: entry.data, parseError: entry.parseError };
}
