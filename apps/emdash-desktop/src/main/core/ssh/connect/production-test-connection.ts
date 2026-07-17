import type { ConnectionTestResult, SshConfig } from '@core/primitives/ssh/api';
import { resolveProductionSshConnectConfig } from './production-connect-config';
import { testSshConnection } from './test-connection';

export function testProductionSshConnection(
  config: SshConfig & { password?: string; passphrase?: string }
): Promise<ConnectionTestResult> {
  return testSshConnection(config, { resolve: resolveProductionSshConnectConfig });
}
