import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  EMDASH_CONFIG_FILE,
  parseEmdashConfig,
  type EmdashConfig,
} from '#primitives/emdash-config/api';

/**
 * One workspace's parsed `.emdash.json` in the registry's live config model
 * (spec: workspace-lifecycle-v2, config live model). Entries are read off the
 * blocking path — at boot, at creation finalize/adoption, and on scans — so
 * creation and activation verbs never touch the file on disk.
 */
export type WorkspaceConfigEntry = {
  config: EmdashConfig;
  /** True when the file existed but did not parse; the empty default applied. */
  parseError: boolean;
};

/** A missing file is the empty config — only a present-but-broken file is an error. */
export async function readWorkspaceConfig(workspacePath: string): Promise<WorkspaceConfigEntry> {
  let content: string;
  try {
    content = await readFile(path.join(workspacePath, EMDASH_CONFIG_FILE), 'utf8');
  } catch {
    return { config: {}, parseError: false };
  }
  const parsed = parseEmdashConfig(content);
  return { config: parsed.data, parseError: !parsed.success };
}
