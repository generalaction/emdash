import type { ChatToolCall } from '../../model';

export const toolFixtures: ChatToolCall[] = [
  {
    kind: 'tool',
    id: 'tl-1',
    name: 'search',
    inputSummary: 'query: "solid js"',
    status: 'running',
  },
  { kind: 'tool', id: 'tl-2', name: 'read_file', inputSummary: 'src/index.ts', status: 'done' },
  { kind: 'tool', id: 'tl-3', name: 'think', inputSummary: undefined, status: 'done' },
];
