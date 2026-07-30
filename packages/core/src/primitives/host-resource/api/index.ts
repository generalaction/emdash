import z from 'zod';

export const hostResourceRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('worktree'),
    hostId: z.string().min(1),
    path: z.string().min(1),
  }),
  z.object({
    kind: z.literal('branch'),
    hostId: z.string().min(1),
    repoPath: z.string().min(1),
    branchName: z.string().min(1),
  }),
  z.object({
    kind: z.literal('repo'),
    hostId: z.string().min(1),
    path: z.string().min(1),
  }),
]);

export type HostResourceRef = z.infer<typeof hostResourceRefSchema>;

export function hostResourceKey(ref: HostResourceRef): string {
  switch (ref.kind) {
    case 'worktree':
      return `worktree:${encodePart(ref.hostId)}:${encodePart(ref.path)}`;
    case 'branch':
      return `branch:${encodePart(ref.hostId)}:${encodePart(ref.repoPath)}:${encodePart(
        ref.branchName
      )}`;
    case 'repo':
      return `repo:${encodePart(ref.hostId)}:${encodePart(ref.path)}`;
  }
}

function encodePart(part: string): string {
  return encodeURIComponent(part);
}
