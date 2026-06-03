import { describe, expect, it } from 'vitest';
import {
  buildBYOISshConnectConfig,
  resolveBYOIForwardAgentEnabled,
  resolveBYOISshConnectConfig,
} from './byoi-ssh-connect-config';

describe('buildBYOISshConnectConfig', () => {
  it('forwards the local SSH agent for BYOI task connections', () => {
    const config = buildBYOISshConnectConfig({
      output: {
        id: 'workspace-1',
        host: 'remote.example.com',
        port: 2222,
        username: 'alice',
        forwardAgent: true,
      },
      forwardAgent: true,
      sshAuthSock: '/tmp/ssh-agent.sock',
    });

    expect(config).toMatchObject({
      host: 'remote.example.com',
      port: 2222,
      username: 'alice',
      agent: '/tmp/ssh-agent.sock',
      agentForward: true,
    });
  });

  it('still forwards the local SSH agent when the BYOI host also uses password auth', () => {
    const config = buildBYOISshConnectConfig({
      output: {
        id: 'workspace-1',
        host: 'remote.example.com',
        password: 'secret',
      },
      forwardAgent: true,
      sshAuthSock: '/tmp/ssh-agent.sock',
    });

    expect(config).toMatchObject({
      host: 'remote.example.com',
      port: 22,
      password: 'secret',
      agent: '/tmp/ssh-agent.sock',
      agentForward: true,
    });
  });

  it('does not request agent forwarding when no local SSH agent socket is available', () => {
    expect(() =>
      buildBYOISshConnectConfig({
        output: {
          id: 'workspace-1',
          host: 'remote.example.com',
        },
        forwardAgent: true,
        sshAuthSock: null,
      })
    ).toThrow('BYOI requested SSH agent forwarding');
  });

  it('preserves SSH agent authentication for passwordless BYOI without forwarding', () => {
    const config = buildBYOISshConnectConfig({
      output: {
        id: 'workspace-1',
        host: 'remote.example.com',
      },
      forwardAgent: false,
      sshAuthSock: '/tmp/ssh-agent.sock',
    });

    expect(config.agent).toBe('/tmp/ssh-agent.sock');
    expect(config.agentForward).toBeUndefined();
  });

  it('allows password auth without an SSH agent when forwarding is disabled', () => {
    const config = buildBYOISshConnectConfig({
      output: {
        id: 'workspace-1',
        host: 'remote.example.com',
        password: 'secret',
      },
      forwardAgent: false,
      sshAuthSock: null,
    });

    expect(config.password).toBe('secret');
    expect(config.agent).toBeUndefined();
    expect(config.agentForward).toBeUndefined();
  });

  it('splits user-qualified hosts for ssh2 connection config', () => {
    const config = buildBYOISshConnectConfig({
      output: {
        id: 'workspace-1',
        host: 'alice@remote.example.com',
      },
      forwardAgent: false,
      sshAuthSock: null,
    });

    expect(config.host).toBe('remote.example.com');
    expect(config.username).toBe('alice');
  });

  it('lets explicit username override a user-qualified host prefix', () => {
    const config = buildBYOISshConnectConfig({
      output: {
        id: 'workspace-1',
        host: 'alice@remote.example.com',
        username: 'bob',
      },
      forwardAgent: false,
      sshAuthSock: null,
    });

    expect(config.host).toBe('remote.example.com');
    expect(config.username).toBe('bob');
  });
});

describe('BYOI SSH agent forwarding resolution', () => {
  it('enables forwarding from explicit provision output', () => {
    const forwardAgent = resolveBYOIForwardAgentEnabled({
      id: 'workspace-1',
      host: 'remote.example.com',
      forwardAgent: true,
    });

    expect(forwardAgent).toBe(true);
  });

  it('disables forwarding from explicit provision output', () => {
    const forwardAgent = resolveBYOIForwardAgentEnabled({
      id: 'workspace-1',
      host: 'remote.example.com',
      forwardAgent: false,
    });

    expect(forwardAgent).toBe(false);
  });

  it('treats omitted forwarding as disabled', () => {
    const forwardAgent = resolveBYOIForwardAgentEnabled({
      id: 'workspace-1',
      host: 'remote.example.com',
    });

    expect(forwardAgent).toBe(false);
  });

  it('uses injected env for explicit provision output forwarding', () => {
    const config = resolveBYOISshConnectConfig(
      {
        id: 'workspace-1',
        host: 'remote.example.com',
        forwardAgent: true,
      },
      {
        env: { SSH_AUTH_SOCK: '/tmp/injected-agent.sock' },
      }
    );

    expect(config).toMatchObject({
      agent: '/tmp/injected-agent.sock',
      agentForward: true,
    });
  });

  it('does not fall back to process env when explicit forwarding uses injected env without a socket', () => {
    expect(() =>
      resolveBYOISshConnectConfig(
        {
          id: 'workspace-1',
          host: 'remote.example.com',
          forwardAgent: true,
        },
        {
          env: {},
        }
      )
    ).toThrow('BYOI requested SSH agent forwarding');
  });

  it('does not fall back to process env when explicit disabled forwarding uses injected env without a socket', () => {
    const config = resolveBYOISshConnectConfig(
      {
        id: 'workspace-1',
        host: 'remote.example.com',
        forwardAgent: false,
      },
      {
        env: {},
      }
    );

    expect(config.agent).toBeUndefined();
    expect(config.agentForward).toBeUndefined();
  });

  it('preserves injected SSH agent auth when forwarding is omitted', () => {
    const config = resolveBYOISshConnectConfig(
      {
        id: 'workspace-1',
        host: 'remote.example.com',
      },
      {
        env: { SSH_AUTH_SOCK: '/tmp/injected-agent.sock' },
      }
    );

    expect(config).toMatchObject({
      agent: '/tmp/injected-agent.sock',
    });
    expect(config.agentForward).toBeUndefined();
  });

  it('does not fall back to process env when omitted forwarding uses injected env without a socket', () => {
    const config = resolveBYOISshConnectConfig(
      {
        id: 'workspace-1',
        host: 'remote.example.com',
      },
      {
        env: {},
      }
    );

    expect(config.agent).toBeUndefined();
    expect(config.agentForward).toBeUndefined();
  });
});
