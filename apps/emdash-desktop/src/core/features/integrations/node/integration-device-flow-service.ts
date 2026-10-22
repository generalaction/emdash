import { randomUUID } from 'node:crypto';
import {
  integrationPluginRegistry,
  type DeviceAuthorizationSession,
} from '@emdash/plugins/integrations';
import type { Logger } from '@emdash/shared/logger';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
import type { DeviceFlowCompleteResult, DeviceFlowStartResult } from '../api/contract';
import type { IntegrationConnections } from '../api/node/integration-accounts';

/**
 * A provider can briefly reject a token it has just issued (seen on GitLab.com),
 * so a failed verification is retried once after this delay.
 */
const VERIFY_RETRY_DELAY_MS = 1000;

type PendingFlow = {
  integrationId: string;
  accountId?: string;
  controller: AbortController;
  session: DeviceAuthorizationSession;
  completing: boolean;
};

/**
 * OAuth device authorization for integrations whose auth behavior implements
 * `startDeviceAuthorization`. `start` returns the user code; `complete` waits
 * for approval, verifies the credentials, and saves the account.
 */
export class IntegrationDeviceFlowService {
  private readonly flows = new Map<string, PendingFlow>();

  constructor(
    private readonly deps: {
      connections: IntegrationConnections;
      logger: Logger;
      clock?: Pick<Clock, 'sleep'>;
    }
  ) {}

  async start(integrationId: string, accountId?: string): Promise<DeviceFlowStartResult> {
    const auth = integrationPluginRegistry.get(integrationId)?.behavior.auth;
    if (!auth?.startDeviceAuthorization) {
      return { success: false, error: `${integrationId} does not support device sign-in.` };
    }
    const session = await auth.startDeviceAuthorization({ log: this.deps.logger });
    if (!session.success) return { success: false, error: session.error.message };

    const flowId = randomUUID();
    this.flows.set(flowId, {
      integrationId,
      ...(accountId ? { accountId } : {}),
      controller: new AbortController(),
      session: session.data,
      completing: false,
    });
    const { userCode, verificationUri, verificationUriComplete, expiresIn } = session.data;
    return {
      success: true,
      flowId,
      userCode,
      verificationUri,
      ...(verificationUriComplete ? { verificationUriComplete } : {}),
      expiresIn,
    };
  }

  /** Aborting `signal` (the caller went away) cancels the flow. */
  async complete(flowId: string, signal?: AbortSignal): Promise<DeviceFlowCompleteResult> {
    const flow = this.flows.get(flowId);
    if (!flow || flow.completing) {
      return { success: false, error: 'This sign-in is no longer active.' };
    }
    flow.completing = true;
    const cancel = () => flow.controller.abort();
    if (signal?.aborted) cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const credentials = await flow.session.complete(flow.controller.signal);
      if (flow.controller.signal.aborted) {
        return { success: false, error: 'Sign-in was cancelled.', cancelled: true };
      }
      if (!credentials.success) return { success: false, error: credentials.error.message };

      const plugin = integrationPluginRegistry.get(flow.integrationId);
      const verify = async () =>
        await plugin?.behavior.auth?.verify({ log: this.deps.logger }, credentials.data);
      let verified = await verify();
      if (verified && !verified.connected && !flow.controller.signal.aborted) {
        const clock = this.deps.clock ?? systemClock;
        const waited = await clock
          .sleep(VERIFY_RETRY_DELAY_MS, { signal: flow.controller.signal })
          .then(() => true)
          .catch(() => false);
        if (waited) verified = await verify();
      }
      if (flow.controller.signal.aborted) {
        return { success: false, error: 'Sign-in was cancelled.', cancelled: true };
      }
      if (!verified?.connected) {
        return { success: false, error: verified?.error ?? 'Sign-in could not be verified.' };
      }
      const connection = await this.deps.connections.connectVerified(flow.integrationId, verified, {
        ...(flow.accountId ? { accountId: flow.accountId } : {}),
        credentialSource: 'device_flow',
        // The save can wait behind a renewal of the same account; cancelling meanwhile saves nothing.
        signal: flow.controller.signal,
      });
      if (!connection.success) {
        return flow.controller.signal.aborted
          ? { success: false, error: 'Sign-in was cancelled.', cancelled: true }
          : { success: false, error: connection.error };
      }
      return {
        success: true,
        accountId: connection.accountId,
        ...(connection.displayName ? { displayName: connection.displayName } : {}),
        ...(connection.account.login ? { login: connection.account.login } : {}),
        ...(connection.account.avatarUrl ? { avatarUrl: connection.account.avatarUrl } : {}),
      };
    } catch (error) {
      this.deps.logger.error('Integration device sign-in failed', {
        integrationId: flow.integrationId,
        error,
      });
      return { success: false, error: 'Sign-in failed.' };
    } finally {
      signal?.removeEventListener('abort', cancel);
      this.flows.delete(flowId);
    }
  }

  cancel(flowId: string): void {
    const flow = this.flows.get(flowId);
    flow?.controller.abort();
    this.flows.delete(flowId);
  }

  dispose(): void {
    for (const flow of this.flows.values()) flow.controller.abort();
    this.flows.clear();
  }
}

let deviceFlowService: IntegrationDeviceFlowService | undefined;

export function setIntegrationDeviceFlowService(service: IntegrationDeviceFlowService): void {
  deviceFlowService = service;
}

export function getIntegrationDeviceFlowService(): IntegrationDeviceFlowService {
  if (!deviceFlowService)
    throw new Error('Integration device flow service has not been configured');
  return deviceFlowService;
}
