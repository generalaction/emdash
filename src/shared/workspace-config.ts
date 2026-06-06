import z from 'zod';

// ---------------------------------------------------------------------------
// Supporting schemas (Branch and its dependencies)
// ---------------------------------------------------------------------------

const remoteSchema = z.object({
  name: z.string(),
  url: z.string(),
});

const branchSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('local'), branch: z.string(), remote: remoteSchema.optional() }),
  z.object({ type: z.literal('remote'), branch: z.string(), remote: remoteSchema }),
]);

// ---------------------------------------------------------------------------
// GitSetup schema — mirrors GitSetup in src/shared/tasks.ts
// ---------------------------------------------------------------------------

const gitSetupSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('use-branch'), branchName: z.string() }),
  z.object({
    kind: z.literal('create-branch'),
    branchName: z.string(),
    fromBranch: branchSchema,
    pushBranch: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('pr-branch'),
    prNumber: z.number(),
    headBranch: z.string(),
    headRepositoryUrl: z.string(),
    isFork: z.boolean(),
    taskBranch: z.string().optional(),
    pushBranch: z.boolean().optional(),
  }),
]);

// ---------------------------------------------------------------------------
// v2 — WorkspaceTarget and WorkspaceConfig
// ---------------------------------------------------------------------------

const workspaceTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('repository-instance'), workspaceId: z.string() }),
  z.object({ kind: z.literal('new-worktree') }),
  z.object({ kind: z.literal('byoi'), remoteWorkspaceId: z.string().optional() }),
]);

export const workspaceConfigSchema = z.object({
  version: z.literal('2'),
  git: gitSetupSchema,
  workspace: workspaceTargetSchema,
});

export type WorkspaceTarget = z.infer<typeof workspaceTargetSchema>;
export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;

// ---------------------------------------------------------------------------
// v1 legacy — stored in workspaces.config and automations.task_config rows
// created before the v2 schema. Kept internal; callers receive WorkspaceConfig.
// ---------------------------------------------------------------------------

const workspaceLocationSchema = z.discriminatedUnion('host', [
  z.object({ host: z.literal('local'), path: z.string().optional() }),
  z.object({ host: z.literal('project-ssh'), path: z.string().optional() }),
  z.object({ host: z.literal('byoi'), remoteWorkspaceId: z.string().optional() }),
]);

const workspaceConfigV1Schema = z.object({
  version: z.literal('1'),
  git: gitSetupSchema,
  workspace: workspaceLocationSchema,
});

type WorkspaceConfigV1 = z.infer<typeof workspaceConfigV1Schema>;

/**
 * Upgrades a parsed v1 config to v2 where possible.
 * `git.kind === 'none'` cannot be upgraded without knowing the project's
 * repositoryWorkspaceId — callers that need the full v2 type must handle
 * the null return for that case.
 */
function upgradeV1(v1: WorkspaceConfigV1): WorkspaceConfig | null {
  const { git, workspace } = v1;
  if (workspace.host === 'byoi') {
    return {
      version: '2',
      git,
      workspace: { kind: 'byoi', remoteWorkspaceId: workspace.remoteWorkspaceId },
    };
  }
  if (git.kind === 'none') {
    // Cannot determine the repositoryWorkspaceId here — caller must resolve.
    return null;
  }
  return { version: '2', git, workspace: { kind: 'new-worktree' } };
}

export function parseWorkspaceConfig(raw: string | null | undefined): WorkspaceConfig | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const v2 = workspaceConfigSchema.safeParse(parsed);
    if (v2.success) return v2.data;
    const v1 = workspaceConfigV1Schema.safeParse(parsed);
    if (v1.success) return upgradeV1(v1.data);
    return null;
  } catch {
    return null;
  }
}

export function serializeWorkspaceConfig(config: WorkspaceConfig): string {
  return JSON.stringify(config);
}
