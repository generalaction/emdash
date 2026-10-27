import type { Result } from '@agent/shared';
import { definePluginCapability } from '@agent/shared/plugins';
import z from 'zod';
import type {
  ConnectedIntegrationHostContext,
  IntegrationHostContext,
} from '../../integrations/host';
import type {
  CreatedRepository,
  CreateRepositoryOpts,
  DeleteRepositoryOpts,
  RepositoryError,
  RepositoryHostProbeResult,
  RepositoryOwner,
} from '../types';

const repositoryDescriptorSchema = z.object({
  /** Hosts this integration owns outright; their remotes route here without a probe. */
  knownHosts: z.array(z.string()).default([]),
});

export type RepositoryDescriptor = z.infer<typeof repositoryDescriptorSchema>;

export type IRepositoryBehavior = {
  listOwners(
    host: ConnectedIntegrationHostContext
  ): Promise<Result<RepositoryOwner[], RepositoryError>>;
  createRepository(
    host: ConnectedIntegrationHostContext,
    opts: CreateRepositoryOpts
  ): Promise<Result<CreatedRepository, RepositoryError>>;
  deleteRepository(
    host: ConnectedIntegrationHostContext,
    opts: DeleteRepositoryOpts
  ): Promise<Result<void, RepositoryError>>;
  /** Unauthenticated check that a host outside `knownHosts` runs this platform. */
  probeHost?(host: IntegrationHostContext, hostname: string): Promise<RepositoryHostProbeResult>;
};

export const repositoryCapability = definePluginCapability<IRepositoryBehavior>()(
  'repository',
  repositoryDescriptorSchema,
  { knownHosts: [] }
);
