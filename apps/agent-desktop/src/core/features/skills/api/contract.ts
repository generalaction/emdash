import { hostRefSchema } from '@agent/core/primitives/host/api';
import {
  agentConfigContract,
  agentConfigSkillsErrorSchema,
  installedSkillsSchema,
} from '@agent/core/runtimes/agent-config/api';
import { runtimeResolveErrorSchema } from '@agent/core/services/runtime-broker/api';
import { defineContract, fallible, liveModel, liveState } from '@agent/wire/rpc';
import { z } from 'zod';

const hostInputSchema = z.object({ host: hostRefSchema });
const skillsErrorSchema = z.union([agentConfigSkillsErrorSchema, runtimeResolveErrorSchema]);

export const skillsDomain = 'skills' as const;

export const skillsContract = defineContract({
  installed: liveModel({
    key: hostInputSchema,
    states: {
      list: liveState({ data: installedSkillsSchema }),
    },
  }),
  install: fallible({
    input: agentConfigContract.installSkill.input.extend(hostInputSchema.shape),
    data: z.object({ skills: installedSkillsSchema }),
    error: skillsErrorSchema,
  }),
  remove: fallible({
    input: agentConfigContract.removeSkill.input.extend(hostInputSchema.shape),
    data: z.object({ skills: installedSkillsSchema }),
    error: skillsErrorSchema,
  }),
  create: fallible({
    input: agentConfigContract.createSkill.input.extend(hostInputSchema.shape),
    data: z.object({ skills: installedSkillsSchema }),
    error: skillsErrorSchema,
  }),
});

export type SkillsContract = typeof skillsContract;
