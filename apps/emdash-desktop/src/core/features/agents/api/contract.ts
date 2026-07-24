import { hostRefSchema } from '@emdash/core/primitives/host/api';
import {
  agentConfigAuthErrorSchema,
  agentConfigContract,
  agentConfigListSchema,
  agentConfigRefreshErrorSchema,
} from '@emdash/core/runtimes/agent-config/api';
import { agentAuthStatusSchema } from '@emdash/core/services/agent-plugins/api/plugins';
import { runtimeResolveErrorSchema } from '@emdash/core/services/runtime-broker/api';
import { defineContract, fallible, liveLog, liveModel, liveState } from '@emdash/wire';
import { z } from 'zod';
import type {
  AgentInstallationStatus,
  AgentPayload,
  AgentSettings,
} from '@core/primitives/agents/api';
import type { ProviderCustomConfig } from '@core/primitives/app-settings/api';

const hostInputSchema = z.object({ host: hostRefSchema });
const agentInputSchema = hostInputSchema.extend({ id: z.string() });
const providerInputSchema = hostInputSchema.extend({ providerId: z.string() });
const agentsAuthErrorSchema = z.union([agentConfigAuthErrorSchema, runtimeResolveErrorSchema]);
const agentsRefreshErrorSchema = z.union([
  agentConfigRefreshErrorSchema,
  runtimeResolveErrorSchema,
]);

export const agentsContract = defineContract({
  list: fallible({
    input: hostInputSchema,
    data: z.custom<AgentPayload[]>(),
    error: runtimeResolveErrorSchema,
  }),
  get: fallible({
    input: agentInputSchema,
    data: z.custom<AgentPayload | null>(),
    error: runtimeResolveErrorSchema,
  }),
  listAgentInstallationStatus: fallible({
    input: hostInputSchema,
    data: z.custom<AgentInstallationStatus[]>(),
    error: runtimeResolveErrorSchema,
  }),
  install: fallible({
    input: agentInputSchema.extend({ method: z.unknown().optional() }),
    data: z.unknown(),
    error: runtimeResolveErrorSchema,
  }),
  update: fallible({
    input: agentInputSchema.extend({ method: z.unknown().optional() }),
    data: z.unknown(),
    error: runtimeResolveErrorSchema,
  }),
  uninstall: fallible({
    input: agentInputSchema.extend({ method: z.unknown().optional() }),
    data: z.unknown(),
    error: runtimeResolveErrorSchema,
  }),
  getDefaultSettings: fallible({
    input: agentInputSchema,
    data: z.custom<ProviderCustomConfig>(),
    error: runtimeResolveErrorSchema,
  }),
  getSettings: fallible({
    input: agentInputSchema,
    data: z.custom<AgentSettings>(),
    error: runtimeResolveErrorSchema,
  }),
  updateSettings: fallible({
    input: agentInputSchema.extend({ config: z.custom<Partial<ProviderCustomConfig>>() }),
    data: z.void(),
    error: runtimeResolveErrorSchema,
  }),
  setUsedInstallation: fallible({
    input: agentInputSchema.extend({ selection: z.unknown().optional() }),
    data: z.void(),
    error: runtimeResolveErrorSchema,
  }),
  probeOverride: fallible({
    input: agentInputSchema.extend({
      selection: z.object({ path: z.string().optional(), cli: z.string().optional() }),
    }),
    data: z.null(),
    error: runtimeResolveErrorSchema,
  }),
  refreshLatestVersion: fallible({
    input: agentInputSchema,
    data: z.void(),
    error: runtimeResolveErrorSchema,
  }),
  probeAll: fallible({
    input: hostInputSchema,
    data: z.void(),
    error: runtimeResolveErrorSchema,
  }),

  auth: liveModel({
    key: hostInputSchema,
    states: {
      list: liveState({ data: agentConfigListSchema }),
    },
  }),
  refreshAgents: fallible({
    input: agentConfigContract.refreshAgents.input.extend(hostInputSchema.shape),
    data: z.void(),
    error: agentsRefreshErrorSchema,
  }),
  startLogin: fallible({
    input: agentConfigContract.startLogin.input.extend(hostInputSchema.shape),
    data: z.void(),
    error: agentsAuthErrorSchema,
  }),
  cancelLogin: fallible({
    input: providerInputSchema,
    data: z.void(),
    error: agentsAuthErrorSchema,
  }),
  sendLoginInput: fallible({
    input: agentConfigContract.sendLoginInput.input.extend(hostInputSchema.shape),
    data: z.void(),
    error: agentsAuthErrorSchema,
  }),
  resizeLogin: fallible({
    input: agentConfigContract.resizeLogin.input.extend(hostInputSchema.shape),
    data: z.void(),
    error: agentsAuthErrorSchema,
  }),
  markUrlHandled: fallible({
    input: agentConfigContract.markUrlHandled.input.extend(hostInputSchema.shape),
    data: z.void(),
    error: agentsAuthErrorSchema,
  }),
  refreshAuthStatus: fallible({
    input: providerInputSchema,
    data: agentAuthStatusSchema,
    error: agentsAuthErrorSchema,
  }),
  loginOutput: liveLog({
    key: providerInputSchema,
  }),
});

export type AgentsContract = typeof agentsContract;
