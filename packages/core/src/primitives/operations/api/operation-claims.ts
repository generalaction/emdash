import { hostResourceKey } from '@primitives/host-resource/api';
import z from 'zod';

export const operationClaimResourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('project'),
    id: z.string().min(1),
  }),
  z.object({
    kind: z.literal('task'),
    id: z.string().min(1),
  }),
  z.object({
    kind: z.literal('workspace'),
    id: z.string().min(1),
  }),
  z.object({
    kind: z.literal('automation'),
    id: z.string().min(1),
  }),
  z.object({
    kind: z.literal('branch'),
    projectId: z.string().min(1),
    name: z.string().min(1),
  }),
  z.object({
    kind: z.literal('worktree'),
    hostRef: z.string().min(1),
    path: z.string().min(1),
  }),
]);

export type OperationClaimResource = z.infer<typeof operationClaimResourceSchema>;

export type OperationClaim = {
  operationId: string;
  resourceKey: string;
};

export function operationClaimResourceKey(resource: OperationClaimResource): string {
  switch (resource.kind) {
    case 'project':
      return `project:${resource.id}`;
    case 'task':
      return `task:${resource.id}`;
    case 'workspace':
      return `workspace:${resource.id}`;
    case 'automation':
      return `automation:${resource.id}`;
    case 'branch':
      return `branch:${resource.projectId}:${resource.name}`;
    case 'worktree':
      return hostResourceKey({
        kind: 'worktree',
        hostId: resource.hostRef,
        path: resource.path,
      });
  }
}
