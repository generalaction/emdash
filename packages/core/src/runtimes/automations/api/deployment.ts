import { hostFileRefSchema } from '@primitives/path/api';
import { Cron } from 'croner';
import { z } from 'zod';

/** Client-minted automation id; also the host deployment primary key. */
export const automationIdSchema = z.string().min(1);

/**
 * Cron schedule evaluated on the host in the captured IANA timezone.
 * The desktop resolves the timezone at save time; there is no host-local fallback.
 */
export const automationScheduleSchema = z
  .object({
    expr: z.string().trim().min(1),
    tz: z.string().trim().min(1),
  })
  .superRefine(({ expr, tz }, ctx) => {
    if (expr.split(/\s+/).length !== 5) {
      ctx.addIssue({
        code: 'custom',
        message: 'cron expression must contain exactly five fields',
        path: ['expr'],
      });
      return;
    }

    try {
      if (!new Cron(expr, { timezone: tz }).nextRun(new Date())) {
        ctx.addIssue({
          code: 'custom',
          message: 'cron expression has no future occurrence',
          path: ['expr'],
        });
      }
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: 'cron expression or timezone is invalid',
        path: ['expr'],
      });
    }
  });

/**
 * Session configuration resolved at deploy time (concrete provider, no
 * default-agent indirection). `autoApprove` is consumed by the host's
 * permission handling since headless runs have no renderer to resolve
 * permission requests. `title` overrides the conversation title shown after
 * adoption; falls back to the deployment name.
 */
export const automationAgentConfigSchema = z.object({
  type: z.enum(['pty', 'acp']),
  providerId: z.string().min(1),
  model: z.string().nullable(),
  prompt: z.string().min(1),
  autoApprove: z.boolean(),
  title: z.string().min(1).optional(),
});

export const automationGitRemoteSchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
});

/**
 * Structurally identical to the workspace runtime's bootstrapGitBranchRefSchema
 * (core module boundaries forbid cross-runtime imports); the executor passes
 * it through to workspace provisioning unchanged.
 */
export const automationGitBranchRefSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('local'),
    branch: z.string().min(1),
    remote: automationGitRemoteSchema.optional(),
  }),
  z.object({
    type: z.literal('remote'),
    branch: z.string().min(1),
    remote: automationGitRemoteSchema,
  }),
]);

/**
 * Git behavior per run. For `create-branch` the branch name is generated per
 * run from the run's generated name; only the base branch is fixed. `none` is
 * only valid together with the `directory` workspace target.
 */
export const automationGitIntentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('create-branch'),
    fromBranch: automationGitBranchRefSchema,
    pushBranch: z.boolean(),
  }),
  z.object({
    kind: z.literal('use-branch'),
    branchName: z.string().min(1),
  }),
  z.object({ kind: z.literal('none') }),
]);

/**
 * Where each run executes. `worktree` provisions a fresh worktree from
 * `repository` per run; `directory` runs in a fixed directory (the desktop
 * resolves its workspace id to a path at deploy time). BYOI/sandbox
 * automations are not deployable to a runtime host and are rejected
 * desktop-side at save.
 */
export const automationWorkspaceTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('worktree') }),
  z.object({ kind: z.literal('directory'), path: hostFileRefSchema }),
]);

const automationDeploymentBaseSchema = z.object({
  automationId: automationIdSchema,
  enabled: z.boolean(),
  name: z.string().min(1),
  schedule: automationScheduleSchema,
  agent: automationAgentConfigSchema,
  repository: hostFileRefSchema,
  git: automationGitIntentSchema,
  workspace: automationWorkspaceTargetSchema,
  /** Desktop updatedAt; monotonic revision for last-write-wins and drift checks. */
  updatedAt: z.number().int().nonnegative(),
});

export const automationDeploymentSchema = automationDeploymentBaseSchema.superRefine(
  (value, ctx) => {
    if (value.workspace.kind === 'worktree' && value.git.kind === 'none') {
      ctx.addIssue({
        code: 'custom',
        message: 'worktree workspace target requires a create-branch or use-branch git intent',
        path: ['git'],
      });
    }
    if (value.workspace.kind === 'directory' && value.git.kind !== 'none') {
      ctx.addIssue({
        code: 'custom',
        message: 'directory workspace target must use git intent none',
        path: ['git'],
      });
    }
  }
);

/**
 * Immutable per-run copy of everything execution and rendering read, captured
 * when the run is inserted. Deploy upserts between schedule and execution must
 * not change what an already-scheduled run does.
 */
export const automationRunConfigSnapshotSchema = automationDeploymentBaseSchema.pick({
  name: true,
  schedule: true,
  agent: true,
  repository: true,
  git: true,
  workspace: true,
});

export type AutomationId = z.infer<typeof automationIdSchema>;
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;
export type AutomationAgentConfig = z.infer<typeof automationAgentConfigSchema>;
export type AutomationGitRemote = z.infer<typeof automationGitRemoteSchema>;
export type AutomationGitBranchRef = z.infer<typeof automationGitBranchRefSchema>;
export type AutomationGitIntent = z.infer<typeof automationGitIntentSchema>;
export type AutomationWorkspaceTarget = z.infer<typeof automationWorkspaceTargetSchema>;
export type AutomationDeployment = z.infer<typeof automationDeploymentSchema>;
export type AutomationRunConfigSnapshot = z.infer<typeof automationRunConfigSnapshotSchema>;
