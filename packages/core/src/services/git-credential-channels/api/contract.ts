import { defineContract, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';

/**
 * Parent-owned end of a session's Git credential channel (spec: github-git-settings §4).
 * The desktop mints a channel for each session start request; the session runtime decides
 * whether a session runs with it and releases it through this contract once no session does.
 * Hosts that never receive channels (remote workspace servers) have nothing to release.
 */
export const gitCredentialChannelsContract = defineContract({
  release: procedure({
    input: z.object({ nonce: z.string().min(1) }),
    output: z.void(),
  }),
});

export type GitCredentialChannelsContract = typeof gitCredentialChannelsContract;
