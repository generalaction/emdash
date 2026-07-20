import { createController, type Controller } from '@emdash/wire/api';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { accountContract } from '../api';
import type { EmdashAccountService } from './services/emdash-account-service';

export function createAccountWireController(service: EmdashAccountService): Controller {
  return createController(accountContract, {
    getSession: () => getSession(service),
    signIn: ({ provider }) => signIn(service, provider),
    linkProviderAccount: ({ provider }) => linkProviderAccount(service, provider),
    signOut: () => signOut(service),
    checkHealth: () => service.checkServerHealth(),
  });
}

async function getSession(service: EmdashAccountService) {
  const result = await service.getSession();
  if (!result.success) {
    log.error('Failed to get account session:', result.error);
    return { user: null, isSignedIn: false, hasAccount: false };
  }
  return result.data;
}

async function signIn(service: EmdashAccountService, provider?: string) {
  const result = await service.signIn(provider);
  if (!result.success) {
    log.error('Account sign-in failed:', result.error);
    return {
      success: false,
      code: result.error.type,
      error: result.error.message,
    };
  }

  telemetryService.capture('user_signed_in');
  return { success: true, user: result.data.user };
}

async function linkProviderAccount(service: EmdashAccountService, provider?: string) {
  const result = await service.linkProviderAccount(provider);
  if (!result.success) {
    if (result.error.type !== 'session_expired') {
      log.error('Provider account link failed:', result.error);
    }
    return {
      success: false,
      code: result.error.type,
      error: result.error.message,
    };
  }

  telemetryService.capture('integration_connected', { provider: result.data.provider });
  return {
    success: true,
    provider: result.data.provider,
    providerAccountStatus: result.data.providerAccountStatus,
    providerAccount: result.data.providerAccount,
  };
}

async function signOut(service: EmdashAccountService) {
  const result = await service.signOut();
  if (!result.success) {
    log.error('Account sign-out failed:', result.error);
    return { success: false, code: result.error.type, error: result.error.message };
  }

  telemetryService.capture('user_signed_out');
  return { success: true };
}
