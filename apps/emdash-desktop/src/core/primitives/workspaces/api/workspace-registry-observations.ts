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

const removalAttemptV1 = z.object({
  version: z.literal('1'),
  /** Removal step that failed: 'teardown' | 'remove' | 'unregister'. */
  stage: z.string(),
  /** Host-decided (ADR 0006): 'transient' retries silently, 'terminal' needs the user. */
  class: z.enum(['transient', 'terminal']),
  message: z.string(),
  at: z.number(),
});

export const workspaceRemovalAttempt = defineVersionedSchema()
  .initial('1', removalAttemptV1)
  .build();
export type WorkspaceRemovalAttempt = typeof workspaceRemovalAttempt.Type;

const scriptOutcomeV1 = z.object({
  outcome: z.enum(['succeeded', 'failed', 'timed-out']),
  at: z.number(),
  /** Present for non-success outcomes. */
  message: z.string().optional(),
});

const scriptOutcomesV1 = z.object({
  version: z.literal('1'),
  prepare: scriptOutcomeV1.nullable(),
  setup: scriptOutcomeV1.nullable(),
  run: scriptOutcomeV1.nullable(),
});

export const workspaceScriptOutcomes = defineVersionedSchema()
  .initial('1', scriptOutcomesV1)
  .build();
export type WorkspaceScriptOutcomes = typeof workspaceScriptOutcomes.Type;

const backgroundStepV1 = z.object({
  status: z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped']),
  at: z.number(),
  /** Present for failed steps. */
  message: z.string().optional(),
});

const runtimeOverlayV1 = z.object({
  version: z.literal('1'),
  creation: z.object({ stage: z.string(), startedAt: z.number() }).nullable(),
  /**
   * Background creation-step statuses (registry contract): unlike the rest of the
   * overlay this is projected from durable host state and survives daemon restarts.
   */
  background: z
    .object({
      cloneArtifacts: backgroundStepV1.nullable(),
      pushBranch: backgroundStepV1.nullable(),
      fetchRefs: backgroundStepV1.nullable(),
    })
    .nullable()
    .optional(),
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
