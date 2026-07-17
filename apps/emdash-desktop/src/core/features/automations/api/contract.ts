import { defineContract, eventStream, procedure } from '@emdash/wire';
import { z } from 'zod';
import type {
  Automation,
  AutomationEvent,
  AutomationRun,
  CreateAutomationParams,
  UpdateAutomationSettingsPatch,
} from '@core/primitives/automations/api';

const automationIdInput = z.object({ automationId: z.string() });

export const automationsContract = defineContract({
  listAutomations: procedure({
    input: z.object({ projectId: z.string().optional() }),
    output: z.array(z.custom<Automation>()),
  }),
  createAutomation: procedure({
    input: z.custom<CreateAutomationParams>(),
    output: z.custom<Automation>(),
  }),
  updateAutomationSettings: procedure({
    input: z.object({ id: z.string(), patch: z.custom<UpdateAutomationSettingsPatch>() }),
    output: z.custom<Automation>(),
  }),
  renameAutomation: procedure({
    input: z.object({ id: z.string(), name: z.string() }),
    output: z.custom<Automation>(),
  }),
  setAutomationEnabled: procedure({
    input: z.object({ id: z.string(), enabled: z.boolean() }),
    output: z.void(),
  }),
  toggleAutomationEnabled: procedure({
    input: z.object({ id: z.string(), enabled: z.boolean() }),
    output: z.void(),
  }),
  listAutomationRuns: procedure({
    input: z.object({
      automationId: z.string(),
      limit: z.number(),
      offset: z.number(),
      statusFilter: z.enum(['done', 'failed', 'skipped']).optional(),
    }),
    output: z.array(z.custom<AutomationRun>()),
  }),
  countAutomationRunsByStatus: procedure({
    input: automationIdInput,
    output: z.object({
      all: z.number(),
      done: z.number(),
      failed: z.number(),
      skipped: z.number(),
    }),
  }),
  getLatestRun: procedure({
    input: automationIdInput,
    output: z.custom<AutomationRun>().nullable(),
  }),
  getNextScheduledRun: procedure({
    input: automationIdInput,
    output: z.custom<AutomationRun>().nullable(),
  }),
  runAutomation: procedure({
    input: automationIdInput,
    output: z.custom<AutomationRun>(),
  }),
  stopRun: procedure({
    input: z.object({ runId: z.string() }),
    output: z.custom<AutomationRun>(),
  }),
  getRun: procedure({
    input: z.object({ runId: z.string() }),
    output: z.custom<AutomationRun>().nullable(),
  }),
  deleteAutomation: procedure({ input: automationIdInput, output: z.void() }),
  events: eventStream({ key: z.void(), event: z.custom<AutomationEvent>() }),
});
