import { defineContract, fallible, liveJob, liveLog, liveModel, liveState } from '@emdash/wire';
import { z } from 'zod';
import { agentAuthStatusSchema } from '../../agents/plugins/capabilities/auth';
import {
  agentConfigErrorSchema,
  agentConfigInstallStrategySchema,
  agentConfigListSchema,
  agentConfigUninstallStrategySchema,
  agentInstallErrorSchema,
  agentInstallProgressSchema,
  agentUninstallErrorSchema,
  createSkillInputSchema,
  dependencyStateSchema,
  installedSkillsSchema,
  markUrlHandledCommandSchema,
  mcpServerListSchema,
  mcpServerSchema,
  providerCommandSchema,
  resizeLoginCommandSchema,
  sendLoginInputCommandSchema,
  skillInstallPayloadSchema,
  startLoginCommandSchema,
} from './schemas';

const provider = z.object({ providerId: z.string() });

export const agentConfigContract = defineContract({
  agents: liveModel({
    key: z.void().optional(),
    states: {
      list: liveState({ data: agentConfigListSchema }),
    },
  }),
  refreshAgents: fallible({
    input: z.object({ providerId: z.string().optional(), refreshShellEnv: z.boolean().optional() }),
    data: z.void(),
    error: agentConfigErrorSchema,
  }),
  installAgent: liveJob({
    input: provider.extend({ strategy: agentConfigInstallStrategySchema }),
    progress: agentInstallProgressSchema,
    result: dependencyStateSchema,
    error: agentInstallErrorSchema,
  }),
  uninstallAgent: fallible({
    input: provider.extend({ strategy: agentConfigUninstallStrategySchema.optional() }),
    data: dependencyStateSchema,
    error: agentUninstallErrorSchema,
  }),

  startLogin: fallible({
    input: startLoginCommandSchema,
    data: z.void(),
    error: agentConfigErrorSchema,
  }),
  cancelLogin: fallible({
    input: providerCommandSchema,
    data: z.void(),
    error: agentConfigErrorSchema,
  }),
  sendLoginInput: fallible({
    input: sendLoginInputCommandSchema,
    data: z.void(),
    error: agentConfigErrorSchema,
  }),
  resizeLogin: fallible({
    input: resizeLoginCommandSchema,
    data: z.void(),
    error: agentConfigErrorSchema,
  }),
  markUrlHandled: fallible({
    input: markUrlHandledCommandSchema,
    data: z.void(),
    error: agentConfigErrorSchema,
  }),
  refreshAuthStatus: fallible({
    input: providerCommandSchema,
    data: agentAuthStatusSchema,
    error: agentConfigErrorSchema,
  }),
  loginOutput: liveLog({ key: providerCommandSchema }),

  mcpServers: liveModel({
    key: z.void().optional(),
    states: {
      list: liveState({ data: mcpServerListSchema }),
    },
  }),
  saveMcpServer: fallible({
    input: z.object({ server: mcpServerSchema }),
    data: z.void(),
    error: agentConfigErrorSchema,
  }),
  removeMcpServer: fallible({
    input: z.object({ name: z.string() }),
    data: z.void(),
    error: agentConfigErrorSchema,
  }),
  listMcpForAgent: fallible({
    input: providerCommandSchema,
    data: mcpServerListSchema,
    error: agentConfigErrorSchema,
  }),

  skills: liveModel({
    key: z.void().optional(),
    states: {
      list: liveState({ data: installedSkillsSchema }),
    },
  }),
  installSkill: fallible({
    input: z.object({ skill: skillInstallPayloadSchema }),
    data: installedSkillsSchema,
    error: agentConfigErrorSchema,
  }),
  removeSkill: fallible({
    input: z.object({ name: z.string() }),
    data: installedSkillsSchema,
    error: agentConfigErrorSchema,
  }),
  createSkill: fallible({
    input: createSkillInputSchema,
    data: installedSkillsSchema,
    error: agentConfigErrorSchema,
  }),
});

export type AgentConfigContract = typeof agentConfigContract;

