import type { ConnectionTestResult, SshConfig } from '@shared/ssh';
import { resolveProductionSshConnectConfig } from './production-connect-config';
import { testSshConnection } from './test-connection';

export function testProductionSshConnection(
  config: SshConfig & { password?: string; passphrase?: string }
): Promise<ConnectionTestResult> {
  return testSshConnection(config, { resolve: resolveProductionSshConnectConfig });
}
