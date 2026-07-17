import ssh2, { type Client, type ConnectConfig } from 'ssh2';
import type { ConnectionTestResult, SshConfig } from '@shared/core/ssh/ssh';
import type { SshConnectResult, TransientConnectInput } from './resolve-ssh-connect-config';

const { Client: Ssh2Client } = ssh2;

export interface TestSshConnectionDeps {
  resolve: (input: TransientConnectInput) => Promise<SshConnectResult>;
  createClient: () => Client;
}

const defaultDeps: Omit<TestSshConnectionDeps, 'resolve'> = {
  createClient: () => new Ssh2Client(),
};

export async function testSshConnection(
  config: SshConfig & { password?: string; passphrase?: string },
  deps: Partial<TestSshConnectionDeps> = {}
): Promise<ConnectionTestResult> {
  if (!deps.resolve) {
    throw new Error('SSH connect resolver dependency was not provided');
  }
  const mergedDeps: TestSshConnectionDeps = { ...defaultDeps, ...deps, resolve: deps.resolve };
  const startTime = Date.now();
  let resolved: SshConnectResult;

  try {
    resolved = await mergedDeps.resolve({ kind: 'transient', config });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      debugLogs: [],
    };
  }

  const debugLogs = resolved.debugLogs;
  const connectConfig: ConnectConfig = {
    ...resolved.config,
    readyTimeout: resolved.config.readyTimeout ?? 10_000,
    debug: (info: string) => debugLogs.push(info),
  };

  return await new Promise<ConnectionTestResult>((resolve) => {
    const client = mergedDeps.createClient();
    let settled = false;
    const finish = (result: ConnectionTestResult) => {
      if (settled) return;
      settled = true;
      resolved.cleanup();
      resolve(result);
    };

    client.on('ready', () => {
      const latency = Date.now() - startTime;
      client.end();
      finish({ success: true, latency, debugLogs });
    });

    client.on('error', (error: Error) => {
      finish({ success: false, error: error.message, debugLogs });
    });

    client.on('close', () => {
      finish({ success: false, error: 'SSH connection closed before ready', debugLogs });
    });

    try {
      client.connect(connectConfig);
    } catch (error) {
      finish({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        debugLogs,
      });
    }
  });
}
