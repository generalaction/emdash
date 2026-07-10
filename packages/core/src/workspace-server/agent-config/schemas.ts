import { z } from 'zod';
import { agentAuthStatusSchema } from '../../agents/plugins/capabilities/auth';
import { INSTALL_METHODS, installOptionSchema } from '../../host-dependencies/capability';
import { mcpServerSchema } from '../../mcp';
import {
  catalogSkillSchema,
  createSkillInputSchema,
  skillInstallPayloadSchema,
} from '../../skills';
import { runtimeUnavailableErrorSchema } from '../shared/schemas';

export const dependencyCategorySchema = z.enum(['core', 'agent']);
export const dependencyStatusSchema = z.enum(['available', 'missing', 'error']);

export const dependencyStateSchema = z.object({
  id: z.string(),
  category: dependencyCategorySchema,
  status: dependencyStatusSchema,
  version: z.string().nullable(),
  path: z.string().nullable(),
  checkedAt: z.number(),
  error: z.string().optional(),
  latestVersion: z.string().nullable().optional(),
  updateAvailable: z.boolean().optional(),
});

export const installCommandErrorSchema = z.union([
  z.object({
    type: z.literal('permission-denied'),
    message: z.string(),
    output: z.string(),
    exitCode: z.number().int().optional(),
  }),
  z.object({
    type: z.literal('command-failed'),
    message: z.string(),
    output: z.string(),
    exitCode: z.number().int().optional(),
  }),
  z.object({ type: z.literal('pty-open-failed'), message: z.string() }),
]);

export const agentConfigUnknownProviderErrorSchema = z.object({
  type: z.literal('unknown-provider'),
  providerId: z.string(),
});
export const agentConfigInvalidStateErrorSchema = z.object({
  type: z.literal('invalid-state'),
  message: z.string(),
});
export const agentConfigIoErrorSchema = z.object({
  type: z.literal('io'),
  path: z.string().optional(),
  message: z.string(),
});

export const agentConfigErrorSchema = z.union([
  agentConfigUnknownProviderErrorSchema,
  agentConfigInvalidStateErrorSchema,
  agentConfigIoErrorSchema,
  installCommandErrorSchema,
  runtimeUnavailableErrorSchema,
]);

export const agentInstallErrorSchema = z.union([
  agentConfigUnknownProviderErrorSchema,
  z.object({ type: z.literal('no-install-command'), providerId: z.string() }),
  installCommandErrorSchema,
  z.object({ type: z.literal('not-detected-after-install'), providerId: z.string() }),
  runtimeUnavailableErrorSchema,
]);

export const agentUninstallErrorSchema = z.union([
  agentConfigUnknownProviderErrorSchema,
  z.object({ type: z.literal('no-uninstall-strategy'), providerId: z.string() }),
  z.object({ type: z.literal('no-uninstall-command'), providerId: z.string() }),
  z.object({ type: z.literal('still-present'), providerId: z.string() }),
  installCommandErrorSchema,
  runtimeUnavailableErrorSchema,
]);

export const agentConfigAuthErrorSchema = z.union([
  agentConfigUnknownProviderErrorSchema,
  agentConfigInvalidStateErrorSchema,
  runtimeUnavailableErrorSchema,
]);
export const agentConfigMcpErrorSchema = z.union([
  agentConfigUnknownProviderErrorSchema,
  agentConfigInvalidStateErrorSchema,
  agentConfigIoErrorSchema,
  runtimeUnavailableErrorSchema,
]);
export const agentConfigSkillsErrorSchema = z.union([
  agentConfigInvalidStateErrorSchema,
  agentConfigIoErrorSchema,
  runtimeUnavailableErrorSchema,
]);
export const agentConfigRefreshErrorSchema = z.union([
  agentConfigUnknownProviderErrorSchema,
  agentConfigInvalidStateErrorSchema,
  runtimeUnavailableErrorSchema,
]);

export const agentConfigInstallStrategySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('package-manager'), method: z.enum(INSTALL_METHODS).optional() }),
  z.object({ kind: z.literal('custom'), command: z.string() }),
]);

export const agentConfigUninstallStrategySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('package-manager'), method: z.enum(INSTALL_METHODS).optional() }),
  z.object({ kind: z.literal('custom'), command: z.string() }),
]);

export const authPendingUrlSchema = z.object({
  id: z.string(),
  url: z.url(),
});

export const authLoginStateSchema = z.object({
  methodId: z.string(),
  startedAt: z.number(),
  pendingUrl: authPendingUrlSchema.nullable(),
  exit: z
    .object({
      exitCode: z.number().int().nullable(),
      signal: z.string().nullable(),
    })
    .nullable(),
});

export const authStatusModelStateSchema = z.object({
  status: agentAuthStatusSchema,
  login: authLoginStateSchema.nullable(),
});

export const agentConfigEntrySchema = z.object({
  providerId: z.string(),
  name: z.string(),
  install: dependencyStateSchema,
  auth: authStatusModelStateSchema,
  installOptions: z.array(installOptionSchema),
});

export const agentConfigListSchema = z.record(z.string(), agentConfigEntrySchema);

export const agentInstallProgressSchema = z.object({
  providerId: z.string(),
  phase: z.enum(['running-command', 'verifying']),
});

export const startLoginCommandSchema = z.object({
  providerId: z.string(),
  methodId: z.string(),
});

export const providerCommandSchema = z.object({ providerId: z.string() });
export const sendLoginInputCommandSchema = providerCommandSchema.extend({ data: z.string() });
export const resizeLoginCommandSchema = providerCommandSchema.extend({
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});
export const markUrlHandledCommandSchema = providerCommandSchema.extend({ urlId: z.string() });

export const mcpServerListSchema = z.array(mcpServerSchema);
export const installedSkillsSchema = z.array(catalogSkillSchema);
export { createSkillInputSchema, mcpServerSchema, skillInstallPayloadSchema };

export type AgentConfigError = z.infer<typeof agentConfigErrorSchema>;
export type AgentInstallError = z.infer<typeof agentInstallErrorSchema>;
export type AgentUninstallError = z.infer<typeof agentUninstallErrorSchema>;
export type AgentConfigAuthError = z.infer<typeof agentConfigAuthErrorSchema>;
export type AgentConfigMcpError = z.infer<typeof agentConfigMcpErrorSchema>;
export type AgentConfigSkillsError = z.infer<typeof agentConfigSkillsErrorSchema>;
export type AgentConfigRefreshError = z.infer<typeof agentConfigRefreshErrorSchema>;
export type DependencyState = z.infer<typeof dependencyStateSchema>;
export type AuthStatusModelState = z.infer<typeof authStatusModelStateSchema>;
export type AuthLoginState = z.infer<typeof authLoginStateSchema>;
export type AuthPendingUrl = z.infer<typeof authPendingUrlSchema>;
export type AgentConfigEntry = z.infer<typeof agentConfigEntrySchema>;
export type AgentConfigList = z.infer<typeof agentConfigListSchema>;
export type AgentInstallProgress = z.infer<typeof agentInstallProgressSchema>;
