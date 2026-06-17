import type { ChatDiff } from '../../model';

export const diffFixtures: ChatDiff[] = [
  {
    kind: 'diff',
    id: 'df-1',
    path: 'src/index.ts',
    oldText: 'const a = 1;\nconst b = 2;',
    newText: 'const a = 1;\nconst b = 3;\nconst c = 4;',
    status: 'done',
  },
  {
    kind: 'diff',
    id: 'df-2',
    path: 'README.md',
    oldText: null,
    newText: 'Hello\nWorld\nThis is new',
    status: 'done',
  },
  {
    kind: 'diff',
    id: 'df-3',
    path: 'src/same.ts',
    oldText: 'unchanged',
    newText: 'unchanged',
    status: 'done',
  },
];
