import * as path from 'path';
import * as os from 'os';

export interface AgentSyncTarget {
  id: string;
  name: string;
  /** Directory where the agent looks for skills/commands */
  getSkillDir: (skillId: string) => string;
  /** Top-level config dir to check if agent is installed */
  configDir: string;
}

const home = os.homedir();

export const agentTargets: AgentSyncTarget[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    configDir: path.join(home, '.claude'),
    getSkillDir: (skillId: string) => path.join(home, '.claude', 'commands', skillId),
  },
  {
    id: 'codex',
    name: 'Codex',
    configDir: path.join(home, '.codex'),
    getSkillDir: (skillId: string) => path.join(home, '.codex', 'skills', skillId),
  },
];
