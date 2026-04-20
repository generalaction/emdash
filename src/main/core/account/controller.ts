import { createRPCController } from '@shared/ipc/rpc';
import { log } from '@main/lib/logger';
import { capture, identify as telemetryIdentify } from '@main/lib/telemetry';
import { emdashAccountService } from './services/emdash-account-service';

export const accountController = createRPCController({
  getSession: async () => {
    try {
      return await emdashAccountService.getSession();
    } catch (error) {
      log.error('Failed to get account session:', error);
      return { user: null, isSignedIn: false, hasAccount: false };
    }
  },

  signIn: async (provider?: string) => {
    try {
      const result = await emdashAccountService.signIn(provider);
      telemetryIdentify(result.user.username, result.user.userId);
      capture('user_signed_in');
      return { success: true, user: result.user };
    } catch (error) {
      log.error('Account sign-in failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Sign-in failed',
      };
    }
  },

  signOut: async () => {
    try {
      await emdashAccountService.signOut();
      capture('user_signed_out');
      return { success: true };
    } catch (error) {
      log.error('Account sign-out failed:', error);
      return { success: false, error: 'Sign-out failed' };
    }
  },

  checkHealth: async () => {
    try {
      return await emdashAccountService.checkServerHealth();
    } catch {
      return false;
    }
  },

  validateSession: async () => {
    try {
      return await emdashAccountService.validateSession();
    } catch {
      return false;
    }
  },
});
