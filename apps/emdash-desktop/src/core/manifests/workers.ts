import { mementosWorker } from '../services/mementos/contributions/worker';
import { pullRequestsWorker } from '../services/pull-requests/contributions/worker';

export const desktopWorkers = {
  acp: {
    id: 'acp',
    entry: 'src/main/gateway/entries/acp.ts',
    file: 'acp-runtime.js',
  },
  'agent-config': {
    id: 'agent-config',
    entry: 'src/main/gateway/entries/agent-config.ts',
    file: 'agent-config-runtime.js',
  },
  'fs-watch': {
    id: 'fs-watch',
    entry: 'src/main/gateway/entries/fs-watch.ts',
    file: 'fs-watch-runtime.js',
  },
  'file-search': {
    id: 'file-search',
    entry: 'src/main/gateway/entries/file-search.ts',
    file: 'file-search-runtime.js',
  },
  files: {
    id: 'files',
    entry: 'src/main/gateway/entries/files.ts',
    file: 'files-runtime.js',
  },
  git: {
    id: 'git',
    entry: 'src/main/gateway/entries/git.ts',
    file: 'git-runtime.js',
  },
  [mementosWorker.id]: mementosWorker,
  [pullRequestsWorker.id]: pullRequestsWorker,
  terminals: {
    id: 'terminals',
    entry: 'src/main/gateway/entries/terminals.ts',
    file: 'terminals-runtime.js',
  },
  'tui-agents': {
    id: 'tui-agents',
    entry: 'src/main/gateway/entries/tui-agents.ts',
    file: 'tui-agents-runtime.js',
  },
} as const;

export type DesktopWorkerId = keyof typeof desktopWorkers;
