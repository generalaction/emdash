import { createController, type Controller } from '@emdash/wire/api';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { accountContract } from '../api';
import { emdashAccountService } from './services/emdash-account-service';

export function createAccountWireController(): Controller {
  return createController(accountContract, {
    getSession,
    signIn: ({ provider }) => signIn(provider),
    linkProviderAccount: ({ provider }) => linkProviderAccount(provider),
    signOut,
    checkHealth: () => emdashAccountService.checkServerHealth(),
  });
}

async function getSession() {
  const result = await emdashAccountService.getSession();
  if (!result.success) {
    log.error('Failed to get account session:', result.error);
    return { user: null, isSignedIn: false, hasAccount: false };
  }
  return result.data;
}

async function signIn(provider?: string) {
  const result = await emdashAccountService.signIn(provider);
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

async function linkProviderAccount(provider?: string) {
  const result = await emdashAccountService.linkProviderAccount(provider);
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

async function signOut() {
  const result = await emdashAccountService.signOut();
  if (!result.success) {
    log.error('Account sign-out failed:', result.error);
    return { success: false, code: result.error.type, error: result.error.message };
  }

  telemetryService.capture('user_signed_out');
  return { success: true };
}
