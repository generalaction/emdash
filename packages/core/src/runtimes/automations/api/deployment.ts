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
 * Structurally mirrors the ACP runtime's promptInputSchema minus attachments
 * (core module boundaries forbid cross-runtime imports). Attachments are
 * deliberately unsupported: runtime-owned attachment ids and desktop-local
 * file paths do not survive storage in a deployment.
 */
export const automationPromptInputSchema = z.object({
  text: z.string().min(1),
  hiddenContext: z.string().optional(),
});

/**
 * Session configuration resolved at deploy time (concrete provider, no
 * default-agent indirection). Each variant's `start` is a template for the
 * matching runtime's start input; the executor and host adapter supply
 * run-generated and host-owned fields (`conversationId`, `cwd`, `sessionId`,
 * terminal geometry, shell setup, hook installation). `title` overrides the
 * conversation title shown after adoption; falls back to the deployment name.
 */
export const automationAcpAgentConfigSchema = z.object({
  type: z.literal('acp'),
  start: z.object({
    providerId: z.string().min(1),
    model: z.string().nullable(),
    modeId: z.string().nullable().optional(),
    initialQueue: z.array(automationPromptInputSchema).min(1),
  }),
  title: z.string().min(1).optional(),
});

/**
 * `autoApprove` is a TUI start-input field consumed by the provider's spawn
 * command; headless runs have no renderer to answer permission prompts.
 */
export const automationTuiAgentConfigSchema = z.object({
  type: z.literal('tui'),
  start: z.object({
    providerId: z.string().min(1),
    model: z.string().nullable(),
    initialPrompt: z.string().min(1),
    autoApprove: z.boolean(),
  }),
  title: z.string().min(1).optional(),
});

export const automationAgentConfigSchema = z.discriminatedUnion('type', [
  automationAcpAgentConfigSchema,
  automationTuiAgentConfigSchema,
]);

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
 * A fresh worktree provisioned for each run. The branch name for
 * `create-branch` is generated per run; only its base and optional publication
 * remote are captured at deploy time.
 */
export const automationWorktreeConfigSchema = z.object({
  kind: z.literal('worktree'),
  repository: hostFileRefSchema,
  git: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('create-branch'),
      fromBranch: automationGitBranchRefSchema,
      /** Resolved push remote captured at deploy time; null means do not publish. */
      pushRemote: z.string().min(1).nullable(),
    }),
    z.object({
      kind: z.literal('use-branch'),
      branchName: z.string().min(1),
    }),
  ]),
});

/** A fixed host directory resolved by the desktop at deploy time. */
export const automationDirectoryConfigSchema = z.object({
  kind: z.literal('directory'),
  path: hostFileRefSchema,
});

/**
 * Where each run executes. The discriminated union makes repository and Git
 * provisioning data available only for worktrees, so every accepted shape is
 * executable without cross-field validation.
 */
export const automationWorkspaceConfigSchema = z.discriminatedUnion('kind', [
  automationWorktreeConfigSchema,
  automationDirectoryConfigSchema,
]);

const automationDeploymentBaseSchema = z.object({
  automationId: automationIdSchema,
  enabled: z.boolean(),
  name: z.string().min(1),
  schedule: automationScheduleSchema,
  agent: automationAgentConfigSchema,
  workspace: automationWorkspaceConfigSchema,
  /** Desktop updatedAt; monotonic revision for last-write-wins and drift checks. */
  updatedAt: z.number().int().nonnegative(),
});

export const automationDeploymentSchema = automationDeploymentBaseSchema;

/**
 * Immutable per-run copy of everything execution and rendering read, captured
 * when the run is inserted. Deploy upserts between schedule and execution must
 * not change what an already-scheduled run does.
 */
export const automationRunConfigSnapshotSchema = automationDeploymentBaseSchema.pick({
  name: true,
  schedule: true,
  agent: true,
  workspace: true,
});

export type AutomationId = z.infer<typeof automationIdSchema>;
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;
export type AutomationPromptInput = z.infer<typeof automationPromptInputSchema>;
export type AutomationAcpAgentConfig = z.infer<typeof automationAcpAgentConfigSchema>;
export type AutomationTuiAgentConfig = z.infer<typeof automationTuiAgentConfigSchema>;
export type AutomationAgentConfig = z.infer<typeof automationAgentConfigSchema>;
export type AutomationGitRemote = z.infer<typeof automationGitRemoteSchema>;
export type AutomationGitBranchRef = z.infer<typeof automationGitBranchRefSchema>;
export type AutomationWorktreeConfig = z.infer<typeof automationWorktreeConfigSchema>;
export type AutomationDirectoryConfig = z.infer<typeof automationDirectoryConfigSchema>;
export type AutomationWorkspaceConfig = z.infer<typeof automationWorkspaceConfigSchema>;
export type AutomationDeployment = z.infer<typeof automationDeploymentSchema>;
export type AutomationRunConfigSnapshot = z.infer<typeof automationRunConfigSnapshotSchema>;
