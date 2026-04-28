import { defineEvent } from '@shared/ipc/events';

export type ForkDetectedPayload = {
  projectId: string;
  forkRemoteName: string;
  upstreamRemoteName: string;
  upstreamOwnerRepo: string;
};

export const forkDetectedChannel = defineEvent<ForkDetectedPayload>('fork:detected');
