import { Client } from 'ssh2';
import { AgentSessionConfig } from './agent-session';
import { GeneralSessionConfig } from './general-session';
import { LifecycleSessionConfig } from './lifecycle-session';
import { Pty } from '../core';

type SessionType = 'agent' | 'general' | 'lifecycle';

type SessionConfig = AgentSessionConfig | GeneralSessionConfig | LifecycleSessionConfig;

export interface CreateSessionOptions {
  type: SessionType;
  config: SessionConfig;
  transport: SessionTransport;
}

type SessionTransport =
  | {
      type: 'local';
      env: Record<string, string>;
    }
  | {
      type: 'ssh2';
      client: Client;
    };

export interface PtySession {
  id: string;
  type: SessionType;
  config: SessionConfig;
  transport: SessionTransport;
  pty: Pty;
}

export class PtySessionManager {
  private sessionMap: Map<string, PtySession> = new Map();
  private ptyMap: Map<string, Pty> = new Map();

  createSession(options: CreateSessionOptions): PtySession {
    const { type, config, transport } = options;

    // spawn a pty register it in the session map

    const session: PtySession = {
      id: crypto.randomUUID(),
      type,
      config,
      transport,
      pty: null, // spawn a pty
    };

    // subscribe to exit events from the pty
    //
  }
}
