import { definePluginCapability } from '@agent/shared/plugins';
import z from 'zod';
import type { PullRequestClient, PullRequestHostContext } from '../types';

const pullRequestsDescriptorSchema = z.object({});

export type PullRequestsDescriptor = z.infer<typeof pullRequestsDescriptorSchema>;

/**
 * Stateful: the client owns its platform's request lanes and rate model, so
 * the host creates one per integration and keeps it for the worker's lifetime.
 */
export type IPullRequestsBehavior = {
  createClient(host: PullRequestHostContext): PullRequestClient;
};

export const pullRequestsCapability = definePluginCapability<IPullRequestsBehavior>()(
  'pullRequests',
  pullRequestsDescriptorSchema
);
