import { defineContract, fallible, liveLog, liveModel, liveState } from '@emdash/wire';
import { agentAuthStatusSchema } from '@services/agent-plugins/api/plugins/capabilities/auth';
import { z } from 'zod';
import {
  agentConfigAuthErrorSchema,
  agentConfigListSchema,
  agentConfigMcpErrorSchema,
  agentConfigRefreshErrorSchema,
  agentConfigSkillsErrorSchema,
  createSkillInputSchema,
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
    error: agentConfigRefreshErrorSchema,
  }),

  startLogin: fallible({
    input: startLoginCommandSchema,
    data: z.void(),
    error: agentConfigAuthErrorSchema,
  }),
  cancelLogin: fallible({
    input: providerCommandSchema,
    data: z.void(),
    error: agentConfigAuthErrorSchema,
  }),
  sendLoginInput: fallible({
    input: sendLoginInputCommandSchema,
    data: z.void(),
    error: agentConfigAuthErrorSchema,
  }),
  resizeLogin: fallible({
    input: resizeLoginCommandSchema,
    data: z.void(),
    error: agentConfigAuthErrorSchema,
  }),
  markUrlHandled: fallible({
    input: markUrlHandledCommandSchema,
    data: z.void(),
    error: agentConfigAuthErrorSchema,
  }),
  refreshAuthStatus: fallible({
    input: providerCommandSchema,
    data: agentAuthStatusSchema,
    error: agentConfigAuthErrorSchema,
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
    error: agentConfigMcpErrorSchema,
  }),
  removeMcpServer: fallible({
    input: z.object({ name: z.string() }),
    data: z.void(),
    error: agentConfigMcpErrorSchema,
  }),
  removeMcpForAgent: fallible({
    input: providerCommandSchema.extend({ name: z.string() }),
    data: z.void(),
    error: agentConfigMcpErrorSchema,
  }),
  listMcpForAgent: fallible({
    input: providerCommandSchema,
    data: mcpServerListSchema,
    error: agentConfigMcpErrorSchema,
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
    error: agentConfigSkillsErrorSchema,
  }),
  removeSkill: fallible({
    input: z.object({ name: z.string() }),
    data: installedSkillsSchema,
    error: agentConfigSkillsErrorSchema,
  }),
  createSkill: fallible({
    input: createSkillInputSchema,
    data: installedSkillsSchema,
    error: agentConfigSkillsErrorSchema,
  }),
});

export type AgentConfigContract = typeof agentConfigContract;
