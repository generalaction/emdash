import type { ChatFileOpToolCall } from '../../model';

export const fileOpFixtures: ChatFileOpToolCall[] = [
  // Single file, running
  { kind: 'file-op', id: 'fo-1', op: 'read', status: 'running', ops: [{ path: 'src/index.ts' }] },
  // Single file, done
  { kind: 'file-op', id: 'fo-2', op: 'edit', status: 'done', ops: [{ path: 'src/utils.ts' }] },
  // Multi file, collapsed + done (header only)
  {
    kind: 'file-op',
    id: 'fo-3',
    op: 'read',
    status: 'done',
    ops: [{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }],
  },
];
