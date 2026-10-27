import { createController, type Controller } from '@agent/wire/rpc';
import { userShellEnvContract, type UserShellEnv } from '#services/shell-env/api';

export function createUserShellEnvController(
  getUserShellEnv: () => Promise<UserShellEnv>
): Controller {
  return createController(userShellEnvContract, {
    get: () => getUserShellEnv(),
  });
}
