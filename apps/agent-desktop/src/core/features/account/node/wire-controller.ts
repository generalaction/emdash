import type { Logger } from '@agent/shared/logger';
import { createController, type Controller } from '@agent/wire/rpc';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import { accountContract } from '../api';
import type { AgentAccountService } from './services/agent-account-service';

type AccountControllerDependencies = {
  logger: Logger;
  telemetry: TelemetryService;
};

export function createAccountWireController(
  service: AgentAccountService,
  dependencies: AccountControllerDependencies
): Controller {
  return createController(accountContract, {
    getSession: () => getSession(service, dependencies.logger),
    signIn: ({ provider, accountId }) => signIn(service, dependencies, provider, accountId),
    linkProviderAccount: ({ provider, accountId }) =>
      linkProviderAccount(service, dependencies, provider, accountId),
    signOut: () => signOut(service, dependencies),
    checkHealth: () => service.checkServerHealth(),
  });
}

async function getSession(service: AgentAccountService, logger: Logger) {
  const result = await service.getSession();
  if (!result.success) {
    logger.error('Failed to get account session', { error: result.error });
    return { user: null, isSignedIn: false, hasAccount: false };
  }
  return result.data;
}

async function signIn(
  service: AgentAccountService,
  dependencies: AccountControllerDependencies,
  provider?: string,
  accountId?: string
) {
  const result = await service.signIn(provider, { accountId });
  if (!result.success) {
    dependencies.logger.error('Account sign-in failed', { error: result.error });
    return {
      success: false,
      code: result.error.type,
      error: result.error.message,
    };
  }

  dependencies.telemetry.capture('user_signed_in');
  return { success: true, user: result.data.user };
}

async function linkProviderAccount(
  service: AgentAccountService,
  dependencies: AccountControllerDependencies,
  provider?: string,
  accountId?: string
) {
  const result = await service.linkProviderAccount(provider, { accountId });
  if (!result.success) {
    if (result.error.type !== 'session_expired') {
      dependencies.logger.error('Provider account link failed', { error: result.error });
    }
    return {
      success: false,
      code: result.error.type,
      error: result.error.message,
    };
  }

  dependencies.telemetry.capture('integration_connected', { provider: result.data.provider });
  return {
    success: true,
    provider: result.data.provider,
    providerAccountStatus: result.data.providerAccountStatus,
    providerAccount: result.data.providerAccount,
  };
}

async function signOut(service: AgentAccountService, dependencies: AccountControllerDependencies) {
  const result = await service.signOut();
  if (!result.success) {
    dependencies.logger.error('Account sign-out failed', { error: result.error });
    return { success: false, code: result.error.type, error: result.error.message };
  }

  dependencies.telemetry.capture('user_signed_out');
  return { success: true };
}
