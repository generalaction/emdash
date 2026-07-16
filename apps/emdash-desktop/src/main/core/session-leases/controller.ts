import { createRPCController } from '@shared/lib/ipc/rpc';
import { sessionLeaseService, type AcquireSessionLeaseInput } from './session-lease-service';

export const sessionLeasesController = createRPCController({
  acquire: (input: AcquireSessionLeaseInput) => sessionLeaseService.acquire(input),
  release: (leaseId: string) => sessionLeaseService.release(leaseId),
  releaseOwner: (ownerId: string) => sessionLeaseService.releaseOwner('desktop', ownerId),
});
