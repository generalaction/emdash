import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import z from 'zod';

// Mirror columns for the host workspace registry (ADR 0005). These are host-owned
// observations, refreshed wholesale on every `records` delivery — the desktop stores
// them opaquely and never edits them. Shapes track the registry contract schemas in
// @emdash/core/runtimes/workspace-registry/api.

const observedGitV1 = z.object({
  version: z.literal('1'),
  branch: z.string().nullable(),
  dirty: z.boolean(),
  /** Untracked files' lines count as additions (registry contract). */
  diffStats: z.object({ added: z.number(), deleted: z.number() }).nullable(),
  ahead: z.number().nullable(),
  behind: z.number().nullable(),
  locked: z.boolean(),
  prunable: z.boolean(),
});

export const workspaceObservedGit = defineVersionedSchema().initial('1', observedGitV1).build();
export type WorkspaceObservedGit = typeof workspaceObservedGit.Type;

const createOutcomeV1 = z.object({
  version: z.literal('1'),
  status: z.enum(['started', 'succeeded', 'failed']),
  at: z.number(),
  /** Present when status is 'failed'. */
  stage: z.string().optional(),
  message: z.string().optional(),
});

export const workspaceCreateOutcome = defineVersionedSchema().initial('1', createOutcomeV1).build();
export type WorkspaceCreateOutcome = typeof workspaceCreateOutcome.Type;

const runtimeOverlayV1 = z.object({
  version: z.literal('1'),
  creation: z.object({ stage: z.string(), startedAt: z.number() }).nullable(),
  notices: z.array(
    z.object({
      id: z.string(),
      kind: z.literal('script-failed'),
      script: z.enum(['prepare', 'setup', 'run', 'teardown']),
      message: z.string(),
      at: z.number(),
    })
  ),
  activation: z
    .object({
      phase: z.enum(['preparing', 'active']),
      scripts: z.object({
        prepare: z.enum(['running', 'succeeded', 'failed', 'skipped']),
        setup: z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped']),
        run: z.enum(['pending', 'running', 'exited', 'failed', 'skipped']),
      }),
      activatedAt: z.number().nullable(),
    })
    .nullable(),
});

export const workspaceRuntimeOverlay = defineVersionedSchema()
  .initial('1', runtimeOverlayV1)
  .build();
export type WorkspaceRuntimeOverlay = typeof workspaceRuntimeOverlay.Type;
