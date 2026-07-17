import { automationsContract as runtimeAutomationsContract } from '@emdash/core/runtimes/automations/api';
import { defineContract, procedure } from '@emdash/wire';
import { z } from 'zod';
import type {
  Automation,
  AutomationRuntimeAvailability,
  CreateAutomationParams,
  UpdateAutomationPatch,
} from '@core/primitives/automations/api';

export const automationsContract = defineContract({
  list: procedure({
    input: z.object({ projectId: z.string().optional() }),
    output: z.array(z.custom<Automation>()),
  }),
  create: procedure({
    input: z.custom<CreateAutomationParams>(),
    output: z.custom<Automation>(),
  }),
  update: procedure({
    input: z.object({ id: z.string(), patch: z.custom<UpdateAutomationPatch>() }),
    output: z.custom<Automation>(),
  }),
  delete: procedure({
    input: z.object({ automationId: z.string() }),
    output: z.void(),
  }),
  adoptRun: procedure({
    input: z.object({ automationId: z.string(), runId: z.string() }),
    output: z.object({ taskId: z.string(), projectId: z.string() }),
  }),
  getTargetAvailability: procedure({
    input: z.object({ projectId: z.string().optional() }),
    output: z.custom<AutomationRuntimeAvailability>(),
  }),
  startRun: runtimeAutomationsContract.startRun,
  cancelRun: runtimeAutomationsContract.cancelRun,
  getRun: runtimeAutomationsContract.getRun,
  listRuns: runtimeAutomationsContract.listRuns,
  listChangedRuns: runtimeAutomationsContract.listChangedRuns,
  getRunOverview: runtimeAutomationsContract.getRunOverview,
  runEvents: runtimeAutomationsContract.runEvents,
});

export type AutomationsContract = typeof automationsContract;
