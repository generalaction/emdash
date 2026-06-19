import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { emdashAccountService } from './services/emdash-account-service';

export const accountController = createRPCController({
  getSession: async () => {
    const result = await emdashAccountService.getSession();
    if (!result.success) {
      log.error('Failed to get account session:', result.error);
      return { user: null, isSignedIn: false, hasAccount: false };
    }
    return result.data;
  },

  signIn: async (provider?: string) => {
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
  },

  linkProviderAccount: async (provider?: string) => {
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
  },

  signOut: async () => {
    const result = await emdashAccountService.signOut();
    if (!result.success) {
      log.error('Account sign-out failed:', result.error);
      return { success: false, code: result.error.type, error: result.error.message };
    }

    telemetryService.capture('user_signed_out');
    return { success: true };
  },

  checkHealth: async () => {
    return await emdashAccountService.checkServerHealth();
  },

  validateSession: async () => {
    const result = await emdashAccountService.validateSession();
    if (!result.success) return false;
    return result.data !== 'invalid';
  },
});
