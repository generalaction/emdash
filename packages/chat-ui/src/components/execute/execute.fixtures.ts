import type { ChatExecute } from '../../model';

export const executeFixtures: ChatExecute[] = [
  {
    kind: 'execute',
    id: 'ex-1',
    command: 'pnpm run build',
    status: 'running',
    startedAt: Date.now(),
  },
  {
    kind: 'execute',
    id: 'ex-2',
    command: 'ls -la',
    status: 'done',
    startedAt: Date.now(),
    durationMs: 120,
  },
  { kind: 'execute', id: 'ex-3', command: '', status: 'error', startedAt: Date.now() },
];
