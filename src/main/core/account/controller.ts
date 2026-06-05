import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { createRPCController } from '@shared/ipc/rpc';
import { rundashAccountService } from './services/rundash-account-service';

export const accountController = createRPCController({
  getSession: async () => {
    try {
      return await rundashAccountService.getSession();
    } catch (error) {
      log.error('Failed to get account session:', error);
      return { user: null, isSignedIn: false, hasAccount: false };
    }
  },

  signIn: async (provider?: string) => {
    try {
      const result = await rundashAccountService.signIn(provider);
      telemetryService.capture('user_signed_in');
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
      await rundashAccountService.signOut();
      telemetryService.capture('user_signed_out');
      return { success: true };
    } catch (error) {
      log.error('Account sign-out failed:', error);
      return { success: false, error: 'Sign-out failed' };
    }
  },

  checkHealth: async () => {
    try {
      return await rundashAccountService.checkServerHealth();
    } catch {
      return false;
    }
  },

  validateSession: async () => {
    try {
      return await rundashAccountService.validateSession();
    } catch {
      return false;
    }
  },
});
